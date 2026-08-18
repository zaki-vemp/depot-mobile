#include "git.hpp"

#include <sys/wait.h>
#include <unistd.h>

#include <cstdlib>
#include <filesystem>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace depot {
namespace git {
namespace {

std::string find_git() {
  static std::string cached;
  static bool looked = false;
  if (looked) {
    return cached;
  }
  looked = true;

  const char* extras[] = {
      "/system/bin/git",
      "/system/xbin/git",
      "/usr/bin/git",
      "/usr/local/bin/git",
      "/opt/homebrew/bin/git",
      "/data/data/com.termux/files/usr/bin/git",
  };
  for (auto* p : extras) {
    if (::access(p, X_OK) == 0) {
      cached = p;
      return cached;
    }
  }

  const char* path = std::getenv("PATH");
  if (!path) {
    return cached;
  }
  std::string rest = path;
  size_t start = 0;
  while (start <= rest.size()) {
    auto cut = rest.find(':', start);
    auto dir = rest.substr(start, cut == std::string::npos ? std::string::npos : cut - start);
    if (!dir.empty()) {
      auto candidate = dir + "/git";
      if (::access(candidate.c_str(), X_OK) == 0) {
        cached = candidate;
        return cached;
      }
    }
    if (cut == std::string::npos) {
      break;
    }
    start = cut + 1;
  }
  return cached;
}

std::string run(const std::string& root, const std::vector<std::string>& args, bool throw_on_fail = true) {
  auto bin = find_git();
  if (bin.empty()) {
    throw std::runtime_error("git is not available");
  }

  int fds[2];
  if (::pipe(fds) != 0) {
    throw std::runtime_error("Could not open a pipe to git");
  }

  pid_t pid = ::fork();
  if (pid < 0) {
    ::close(fds[0]);
    ::close(fds[1]);
    throw std::runtime_error("Could not start git");
  }
  if (pid == 0) {
    ::chdir(root.c_str());
    ::dup2(fds[1], STDOUT_FILENO);
    ::dup2(fds[1], STDERR_FILENO);
    ::close(fds[0]);
    ::close(fds[1]);
    ::setenv("GIT_TERMINAL_PROMPT", "0", 1);
    ::setenv("GIT_OPTIONAL_LOCKS", "0", 1);
    std::vector<char*> argv;
    argv.push_back(const_cast<char*>(bin.c_str()));
    for (auto const& a : args) {
      argv.push_back(const_cast<char*>(a.c_str()));
    }
    argv.push_back(nullptr);
    ::execv(bin.c_str(), argv.data());
    _exit(127);
  }

  ::close(fds[1]);
  std::string out;
  char buf[4096];
  ssize_t n;
  while ((n = ::read(fds[0], buf, sizeof(buf))) > 0) {
    out.append(buf, static_cast<size_t>(n));
  }
  ::close(fds[0]);
  int status = 0;
  ::waitpid(pid, &status, 0);
  if (throw_on_fail && (!WIFEXITED(status) || WEXITSTATUS(status) != 0)) {
    auto err = out;
    while (!err.empty() && (err.back() == '\n' || err.back() == '\r')) {
      err.pop_back();
    }
    throw std::runtime_error(err.empty() ? "git failed" : err);
  }
  return out;
}

std::string kind_for(char code) {
  switch (code) {
    case 'M':
    case 'T':
      return "modified";
    case 'A':
      return "added";
    case 'D':
      return "deleted";
    case 'R':
      return "renamed";
    case 'C':
      return "copied";
    case 'U':
    case '!':
      return "conflicted";
    case '?':
      return "untracked";
    default:
      return "modified";
  }
}

File file_entry(const std::string& root, const std::string& rel, char code, bool staged,
                std::optional<std::string> orig) {
  File f;
  f.path = rel;
  f.abs_path = (fs::path(root) / rel).string();
  auto slash = rel.find_last_of('/');
  f.name = slash == std::string::npos ? rel : rel.substr(slash + 1);
  f.kind = kind_for(code);
  f.staged = staged;
  f.orig_path = std::move(orig);
  return f;
}

void parse_status(const std::string& root, const std::string& raw, std::vector<File>& staged,
                  std::vector<File>& unstaged) {
  size_t i = 0;
  while (i < raw.size()) {
    auto end = raw.find('\0', i);
    if (end == std::string::npos) {
      end = raw.size();
    }
    auto entry = raw.substr(i, end - i);
    i = end + 1;
    if (entry.size() < 4) {
      continue;
    }
    char x = entry[0];
    char y = entry[1];
    std::string path = entry.substr(3);
    std::optional<std::string> orig;
    if (x == 'R' || x == 'C') {
      auto orig_end = raw.find('\0', i);
      if (orig_end == std::string::npos) {
        orig_end = raw.size();
      }
      orig = raw.substr(i, orig_end - i);
      i = orig_end + 1;
    }
    if (x == '?' && y == '?') {
      unstaged.push_back(file_entry(root, path, '?', false, orig));
      continue;
    }
    if (x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D')) {
      unstaged.push_back(file_entry(root, path, 'U', false, orig));
      continue;
    }
    if (x != ' ') {
      staged.push_back(file_entry(root, path, x, true, orig));
    }
    if (y != ' ') {
      unstaged.push_back(file_entry(root, path, y, false, orig));
    }
  }
}

std::string trim(std::string s) {
  while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ')) {
    s.pop_back();
  }
  size_t start = 0;
  while (start < s.size() && (s[start] == ' ' || s[start] == '\n' || s[start] == '\r')) {
    ++start;
  }
  return s.substr(start);
}

}  // namespace

std::optional<Repo> info(const std::string& cwd) {
  if (find_git().empty()) {
    return std::nullopt;
  }
  std::error_code ec;
  if (!fs::is_directory(cwd, ec)) {
    return std::nullopt;
  }

  std::string root;
  try {
    root = trim(run(cwd, {"rev-parse", "--show-toplevel"}));
  } catch (...) {
    return std::nullopt;
  }
  if (root.empty()) {
    return std::nullopt;
  }

  Repo repo;
  repo.root = root;

  try {
    repo.branch = trim(run(root, {"rev-parse", "--abbrev-ref", "HEAD"}));
  } catch (...) {
    repo.branch.clear();
  }
  if (repo.branch.empty() || repo.branch == "HEAD") {
    try {
      repo.branch = trim(run(root, {"symbolic-ref", "--short", "HEAD"}));
    } catch (...) {
      repo.branch = "detached";
    }
  }

  try {
    auto up = trim(run(root, {"rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"}, false));
    if (!up.empty() && up.find("fatal") == std::string::npos) {
      repo.upstream = up;
    }
  } catch (...) {
  }

  if (repo.upstream) {
    try {
      auto counts = trim(run(root, {"rev-list", "--left-right", "--count", "@{upstream}...HEAD"}));
      std::istringstream ss(counts);
      ss >> repo.behind >> repo.ahead;
    } catch (...) {
    }
  }

  auto raw = run(root, {"status", "--porcelain=v1", "-z", "--untracked-files=all"});
  parse_status(root, raw, repo.staged, repo.unstaged);
  return repo;
}

std::string show(const std::string& root, const std::string& rev, const std::string& path) {
  std::string spec = rev == ":" ? ":" + path : rev + ":" + path;
  try {
    return run(root, {"show", spec});
  } catch (...) {
    return {};
  }
}

void stage(const std::string& root, const std::vector<std::string>& paths) {
  if (paths.empty()) {
    return;
  }
  std::vector<std::string> args{"add", "--"};
  args.insert(args.end(), paths.begin(), paths.end());
  run(root, args);
}

void unstage(const std::string& root, const std::vector<std::string>& paths) {
  if (paths.empty()) {
    return;
  }
  bool has_head = true;
  try {
    run(root, {"rev-parse", "--verify", "HEAD"});
  } catch (...) {
    has_head = false;
  }
  std::vector<std::string> args;
  if (!has_head) {
    args = {"rm", "--cached", "-r", "--"};
  } else {
    args = {"restore", "--staged", "--"};
  }
  args.insert(args.end(), paths.begin(), paths.end());
  run(root, args);
}

void discard(const std::string& root, const std::vector<std::string>& paths) {
  if (paths.empty()) {
    return;
  }
  std::vector<std::string> args{"checkout", "HEAD", "--"};
  args.insert(args.end(), paths.begin(), paths.end());
  try {
    run(root, args);
    return;
  } catch (...) {
  }
  args = {"clean", "-fd", "--"};
  args.insert(args.end(), paths.begin(), paths.end());
  run(root, args);
}

std::string commit(const std::string& root, const std::string& message, bool amend) {
  if (trim(message).empty() && !amend) {
    throw std::runtime_error("Write a commit message first");
  }
  std::vector<std::string> args{"commit", "-m", message};
  if (amend) {
    args.push_back("--amend");
  }
  return run(root, args);
}

}  // namespace git
}  // namespace depot
