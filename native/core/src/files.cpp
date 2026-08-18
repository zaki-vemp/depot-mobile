#include "files.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <system_error>

#if defined(__unix__) || defined(__APPLE__)
#include <sys/stat.h>
#include <sys/statvfs.h>
#endif

namespace fs = std::filesystem;

namespace depot {
namespace {

std::string g_home;
std::string g_trash;

void ensure_dir(const fs::path& p) {
  std::error_code ec;
  fs::create_directories(p, ec);
  if (ec) {
    throw std::runtime_error(ec.message());
  }
}

std::string unique_in(const fs::path& dir, const std::string& name) {
  fs::path candidate = dir / name;
  if (!fs::exists(candidate)) {
    return candidate.string();
  }
  auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                 std::chrono::system_clock::now().time_since_epoch())
                 .count();
  return (dir / (name + "-" + std::to_string(now))).string();
}

bool is_hidden_name(const std::string& name) { return !name.empty() && name[0] == '.'; }

void add_place_if_exists(std::vector<Place>& out, const std::string& name, const fs::path& path,
                         const std::string& kind) {
  std::error_code ec;
  if (fs::exists(path, ec) && fs::is_directory(path, ec)) {
    out.push_back({name, path.string(), kind});
  }
}

void copy_dir(const fs::path& src, const fs::path& dest) {
  ensure_dir(dest);
  for (auto const& entry : fs::recursive_directory_iterator(src, fs::directory_options::skip_permission_denied)) {
    std::error_code ec;
    auto rel = fs::relative(entry.path(), src, ec);
    if (ec) {
      continue;
    }
    auto target = dest / rel;
    if (entry.is_directory()) {
      ensure_dir(target);
    } else if (entry.is_regular_file()) {
      ensure_dir(target.parent_path());
      fs::copy_file(entry.path(), target, fs::copy_options::overwrite_existing, ec);
      if (ec) {
        throw std::runtime_error(ec.message());
      }
    }
  }
}

}  // namespace

void configure(const std::string& home, const std::string& trash) {
  g_home = home;
  g_trash = trash;
  if (!g_trash.empty()) {
    ensure_dir(g_trash);
  }
}

const std::string& home_dir() { return g_home; }

const std::string& trash_dir() { return g_trash; }

std::string join_path(const std::string& dir, const std::string& name) {
  if (dir.empty()) {
    return name;
  }
  if (dir.back() == '/' || dir.back() == '\\') {
    return dir + name;
  }
  return dir + "/" + name;
}

std::string base_name(const std::string& path) {
  auto p = fs::path(path).filename().string();
  return p.empty() ? path : p;
}

std::vector<Place> places() {
  std::vector<Place> out;
  if (!g_home.empty()) {
    out.push_back({"Internal storage", g_home, "home"});
    add_place_if_exists(out, "Download", fs::path(g_home) / "Download", "downloads");
    add_place_if_exists(out, "Downloads", fs::path(g_home) / "Downloads", "downloads");
    add_place_if_exists(out, "Documents", fs::path(g_home) / "Documents", "documents");
    add_place_if_exists(out, "Pictures", fs::path(g_home) / "Pictures", "pictures");
    add_place_if_exists(out, "DCIM", fs::path(g_home) / "DCIM", "pictures");
    add_place_if_exists(out, "Music", fs::path(g_home) / "Music", "music");
    add_place_if_exists(out, "Movies", fs::path(g_home) / "Movies", "movies");
    add_place_if_exists(out, "Movies", fs::path(g_home) / "Video", "movies");
  }
  if (!g_trash.empty()) {
    add_place_if_exists(out, "Trash", g_trash, "trash");
  }

  std::error_code ec;
  fs::path storage("/storage");
  if (fs::exists(storage, ec) && fs::is_directory(storage, ec)) {
  for (auto const& entry : fs::directory_iterator(storage, fs::directory_options::skip_permission_denied)) {
      if (!entry.is_directory()) {
        continue;
      }
      auto name = entry.path().filename().string();
      if (name == "emulated" || name == "self" || name == "." || name == "..") {
        continue;
      }
      if (is_hidden_name(name)) {
        continue;
      }
      bool seen = false;
      for (auto const& p : out) {
        if (p.path == entry.path().string()) {
          seen = true;
          break;
        }
      }
      if (!seen) {
        out.push_back({name, entry.path().string(), "volume"});
      }
    }
  }
  return out;
}

std::vector<DirEntry> list_dir(const std::string& path) {
  fs::path root(path);
  std::error_code ec;
  if (!fs::exists(root, ec)) {
    throw std::runtime_error("Path does not exist: " + path);
  }
  if (!fs::is_directory(root, ec)) {
    throw std::runtime_error("Not a directory");
  }

  std::vector<DirEntry> items;
  for (auto const& entry : fs::directory_iterator(root, fs::directory_options::skip_permission_denied)) {
    DirEntry item;
    item.name = entry.path().filename().string();
    item.path = entry.path().string();
    item.is_dir = entry.is_directory(ec);
    if (item.is_dir) {
      item.size = 0;
      item.ext.clear();
    } else {
      item.size = entry.is_regular_file(ec) ? entry.file_size(ec) : 0;
      auto ext = entry.path().extension().string();
      if (!ext.empty() && ext[0] == '.') {
        ext.erase(ext.begin());
      }
      std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      item.ext = ext;
    }
#if defined(__unix__) || defined(__APPLE__)
    struct stat st {};
    if (::stat(entry.path().c_str(), &st) == 0) {
      item.modified = static_cast<int64_t>(st.st_mtime);
    }
#endif
    items.push_back(std::move(item));
  }

  std::sort(items.begin(), items.end(), [](const DirEntry& a, const DirEntry& b) {
    if (a.is_dir != b.is_dir) {
      return a.is_dir;
    }
    auto la = a.name;
    auto lb = b.name;
    std::transform(la.begin(), la.end(), la.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    std::transform(lb.begin(), lb.end(), lb.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return la < lb;
  });
  return items;
}

std::vector<DirEntry> search(const std::string& root, const std::string& query, size_t limit) {
  std::string needle = query;
  std::transform(needle.begin(), needle.end(), needle.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  std::vector<DirEntry> out;
  if (needle.empty()) {
    return out;
  }

  std::error_code ec;
  fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec);
  if (ec) {
    throw std::runtime_error(ec.message());
  }
  for (; it != fs::recursive_directory_iterator(); it.increment(ec)) {
    if (ec) {
      ec.clear();
      continue;
    }
    auto name = it->path().filename().string();
    auto lowered = name;
    std::transform(lowered.begin(), lowered.end(), lowered.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lowered.find(needle) == std::string::npos) {
      continue;
    }

    DirEntry item;
    item.name = name;
    item.path = it->path().string();
    item.is_dir = it->is_directory(ec);
    if (!item.is_dir) {
      item.size = it->is_regular_file(ec) ? it->file_size(ec) : 0;
      auto ext = it->path().extension().string();
      if (!ext.empty() && ext[0] == '.') {
        ext.erase(ext.begin());
      }
      std::transform(ext.begin(), ext.end(), ext.begin(),
                     [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      item.ext = ext;
    }
#if defined(__unix__) || defined(__APPLE__)
    struct stat st {};
    if (::stat(it->path().c_str(), &st) == 0) {
      item.modified = static_cast<int64_t>(st.st_mtime);
    }
#endif
    out.push_back(std::move(item));
    if (out.size() >= limit) {
      break;
    }
  }
  return out;
}

std::string read_text(const std::string& path, size_t max_bytes) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    throw std::runtime_error("Could not read file");
  }
  in.seekg(0, std::ios::end);
  auto size = static_cast<size_t>(in.tellg());
  if (size > max_bytes) {
    throw std::runtime_error("File is larger than " + std::to_string(max_bytes) + " bytes");
  }
  in.seekg(0, std::ios::beg);
  std::string data(size, '\0');
  in.read(data.data(), static_cast<std::streamsize>(size));
  return data;
}

void write_text(const std::string& path, const std::string& contents) {
  fs::path p(path);
  std::error_code ec;
  if (fs::is_directory(p, ec)) {
    throw std::runtime_error("Path is a directory");
  }
  if (p.has_parent_path()) {
    ensure_dir(p.parent_path());
  }
  std::ofstream out(p, std::ios::binary | std::ios::trunc);
  if (!out) {
    throw std::runtime_error("Could not write file");
  }
  out.write(contents.data(), static_cast<std::streamsize>(contents.size()));
  if (!out) {
    throw std::runtime_error("Could not write file");
  }
}

void create_file(const std::string& path) {
  fs::path p(path);
  std::error_code ec;
  if (fs::exists(p, ec)) {
    throw std::runtime_error(p.string() + " already exists");
  }
  if (p.has_parent_path()) {
    ensure_dir(p.parent_path());
  }
  std::ofstream out(p, std::ios::binary | std::ios::trunc);
  if (!out) {
    throw std::runtime_error("Could not create file");
  }
}

bool is_text_file(const std::string& path, size_t sniff_bytes) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    throw std::runtime_error("Could not read file");
  }
  std::string buf(sniff_bytes, '\0');
  in.read(buf.data(), static_cast<std::streamsize>(sniff_bytes));
  buf.resize(static_cast<size_t>(in.gcount()));
  return buf.find('\0') == std::string::npos;
}

void empty_trash() {
  if (g_trash.empty()) {
    throw std::runtime_error("Trash is not configured");
  }
  std::error_code ec;
  for (auto const& entry : fs::directory_iterator(g_trash, fs::directory_options::skip_permission_denied)) {
    fs::remove_all(entry.path(), ec);
    if (ec) {
      throw std::runtime_error(ec.message());
    }
  }
}

void mkdir_path(const std::string& path) { ensure_dir(path); }

void rename_path(const std::string& from, const std::string& to) {
  std::error_code ec;
  fs::rename(from, to, ec);
  if (ec) {
    throw std::runtime_error(ec.message());
  }
}

void remove_path(const std::string& path) {
  std::error_code ec;
  auto n = fs::remove_all(path, ec);
  if (ec) {
    throw std::runtime_error(ec.message());
  }
  if (n == 0 && !fs::exists(path)) {
    throw std::runtime_error("Path does not exist");
  }
}

void trash_path(const std::string& path) {
  if (g_trash.empty()) {
    throw std::runtime_error("Trash is not configured");
  }
  ensure_dir(g_trash);
  auto dest = unique_in(g_trash, base_name(path));
  rename_path(path, dest);
}

void copy_path(const std::string& from, const std::string& to) {
  fs::path src(from);
  fs::path dest(to);
  std::error_code ec;
  if (!fs::exists(src, ec)) {
    throw std::runtime_error("Source does not exist");
  }
  if (fs::is_directory(src, ec)) {
    copy_dir(src, dest);
    return;
  }
  ensure_dir(dest.parent_path());
  fs::copy_file(src, dest, fs::copy_options::overwrite_existing, ec);
  if (ec) {
    throw std::runtime_error(ec.message());
  }
}

void move_path(const std::string& from, const std::string& to) {
  std::error_code ec;
  fs::rename(from, to, ec);
  if (!ec) {
    return;
  }
  copy_path(from, to);
  remove_path(from);
}

std::optional<std::string> parent_path(const std::string& path) {
  auto parent = fs::path(path).parent_path();
  if (parent.empty() || parent == path) {
    return std::nullopt;
  }
  auto s = parent.string();
  if (s.empty()) {
    return std::nullopt;
  }
  return s;
}

DiskUsage disk_usage(const std::string& path) {
  DiskUsage usage;
#if defined(__unix__) || defined(__APPLE__)
  struct statvfs vfs {};
  if (statvfs(path.c_str(), &vfs) != 0) {
    throw std::runtime_error("No volume found for " + path);
  }
  usage.total = static_cast<uint64_t>(vfs.f_frsize) * static_cast<uint64_t>(vfs.f_blocks);
  usage.free = static_cast<uint64_t>(vfs.f_frsize) * static_cast<uint64_t>(vfs.f_bavail);
  usage.mount = path;
#else
  auto space = fs::space(path);
  usage.total = space.capacity;
  usage.free = space.available;
  usage.mount = path;
#endif
  return usage;
}

uint64_t total_size(const std::string& path) {
  fs::path p(path);
  std::error_code ec;
  if (fs::is_regular_file(p, ec)) {
    return fs::file_size(p, ec);
  }
  uint64_t sum = 0;
  for (auto const& entry : fs::recursive_directory_iterator(p, fs::directory_options::skip_permission_denied)) {
    if (entry.is_regular_file(ec)) {
      sum += entry.file_size(ec);
    }
  }
  return sum;
}

std::vector<std::string> list_files_recursive(const std::string& root) {
  std::vector<std::string> out;
  fs::path base(root);
  std::error_code ec;
  if (fs::is_regular_file(base, ec)) {
    out.push_back(root);
    return out;
  }
    for (auto const& entry : fs::recursive_directory_iterator(base, fs::directory_options::skip_permission_denied)) {
    if (entry.is_regular_file(ec)) {
      out.push_back(entry.path().string());
    }
  }
  return out;
}

}  // namespace depot
