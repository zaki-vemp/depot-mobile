#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace depot {
namespace git {

struct File {
  std::string path;
  std::string abs_path;
  std::string name;
  std::string kind;
  bool staged = false;
  std::optional<std::string> orig_path;
};

struct Repo {
  std::string root;
  std::string branch;
  uint32_t ahead = 0;
  uint32_t behind = 0;
  std::optional<std::string> upstream;
  std::vector<File> staged;
  std::vector<File> unstaged;
};

/** Null when git is missing or `cwd` is not inside a repository. */
std::optional<Repo> info(const std::string& cwd);
std::string show(const std::string& root, const std::string& rev, const std::string& path);
void stage(const std::string& root, const std::vector<std::string>& paths);
void unstage(const std::string& root, const std::vector<std::string>& paths);
void discard(const std::string& root, const std::vector<std::string>& paths);
std::string commit(const std::string& root, const std::string& message, bool amend);

}  // namespace git
}  // namespace depot
