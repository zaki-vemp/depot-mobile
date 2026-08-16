#include "files.hpp"
#include "json.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#if defined(__unix__) || defined(__APPLE__)
#include <sys/stat.h>
#endif

namespace depot {

constexpr size_t kChunk = 512 * 1024;

using ProgressFn = std::function<void(uint64_t moved, uint64_t total, const char* state, const char* error)>;

namespace {
std::mutex g_cancel_mutex;
std::set<std::string> g_cancelled;

bool is_cancelled(const std::string& id) {
  std::lock_guard<std::mutex> lock(g_cancel_mutex);
  return g_cancelled.count(id) != 0;
}

void clear_cancelled(const std::string& id) {
  std::lock_guard<std::mutex> lock(g_cancel_mutex);
  g_cancelled.erase(id);
}
}  // namespace

void transfer_cancel(const std::string& id) {
  std::lock_guard<std::mutex> lock(g_cancel_mutex);
  g_cancelled.insert(id);
}

static bool same_volume(const std::string& a, const std::string& b) {
#if defined(__unix__) || defined(__APPLE__)
  struct stat sa {};
  struct stat sb {};
  if (::stat(a.c_str(), &sa) != 0 || ::stat(b.c_str(), &sb) != 0) {
    return false;
  }
  return sa.st_dev == sb.st_dev;
#else
  (void)a;
  (void)b;
  return false;
#endif
}

static void copy_file_chunked(const std::string& id, const std::string& from, const std::string& to, uint64_t& moved,
                              uint64_t total, ProgressFn const& report) {
  std::ifstream in(from, std::ios::binary);
  if (!in) {
    throw std::runtime_error("Could not read " + from);
  }
  auto parent = std::filesystem::path(to).parent_path();
  std::error_code ec;
  std::filesystem::create_directories(parent, ec);
  std::ofstream out(to, std::ios::binary | std::ios::trunc);
  if (!out) {
    throw std::runtime_error("Could not write " + to);
  }
  std::vector<char> buf(kChunk);
  auto last = std::chrono::steady_clock::now();
  while (in) {
    if (is_cancelled(id)) {
      out.close();
      std::error_code rm;
      std::filesystem::remove(to, rm);
      throw std::runtime_error("Cancelled");
    }
    in.read(buf.data(), static_cast<std::streamsize>(buf.size()));
    auto n = in.gcount();
    if (n <= 0) {
      break;
    }
    out.write(buf.data(), n);
    moved += static_cast<uint64_t>(n);
    auto now = std::chrono::steady_clock::now();
    if (now - last >= std::chrono::milliseconds(200)) {
      report(moved, total, "running", nullptr);
      last = now;
    }
  }
}

static void run_local_copy(const std::string& id, const std::string& from, const std::string& to, bool is_move,
                           ProgressFn const& report) {
  auto total = total_size(from);
  report(0, total, "running", nullptr);
  uint64_t moved = 0;

  std::error_code ec;
  if (is_move && same_volume(from, std::filesystem::path(to).parent_path().string())) {
    std::filesystem::rename(from, to, ec);
    if (!ec) {
      report(total, total, "done", nullptr);
      return;
    }
  }

  if (std::filesystem::is_directory(from)) {
    auto files = list_files_recursive(from);
    auto root = std::filesystem::path(from);
    for (auto const& file : files) {
      auto rel = std::filesystem::relative(file, root);
      auto dest = (std::filesystem::path(to) / rel).string();
      copy_file_chunked(id, file, dest, moved, total, report);
    }
  } else {
    copy_file_chunked(id, from, to, moved, total, report);
  }

  if (is_move) {
    remove_path(from);
  }
  report(total, total, "done", nullptr);
}

void transfer_run(const std::string& id, const std::string& from, const std::string& to, const std::string& op,
                  ProgressFn const& report) {
  bool is_move = op == "move";
  if (op != "copy" && op != "move" && op != "upload" && op != "download") {
    throw std::runtime_error("Unknown transfer type: " + op);
  }
  clear_cancelled(id);
  try {
    run_local_copy(id, from, to, is_move, report);
  } catch (...) {
    clear_cancelled(id);
    throw;
  }
  clear_cancelled(id);
}

}  // namespace depot
