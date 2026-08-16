#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace depot {

struct DirEntry {
  std::string name;
  std::string path;
  bool is_dir = false;
  uint64_t size = 0;
  std::optional<int64_t> modified;
  std::string ext;
  std::string source = "local";
};

struct Place {
  std::string name;
  std::string path;
  std::string kind;
};

struct DiskUsage {
  uint64_t total = 0;
  uint64_t free = 0;
  std::string mount;
};

void configure(const std::string& home, const std::string& trash);
const std::string& home_dir();
const std::string& trash_dir();

std::vector<Place> places();
std::vector<DirEntry> list_dir(const std::string& path);
/** Case-insensitive name match walked off the JS thread; stops at `limit` hits. */
std::vector<DirEntry> search(const std::string& root, const std::string& query, size_t limit);
std::string read_text(const std::string& path, size_t max_bytes);
void mkdir_path(const std::string& path);
void rename_path(const std::string& from, const std::string& to);
void remove_path(const std::string& path);
void trash_path(const std::string& path);
void copy_path(const std::string& from, const std::string& to);
void move_path(const std::string& from, const std::string& to);
std::optional<std::string> parent_path(const std::string& path);
DiskUsage disk_usage(const std::string& path);
uint64_t total_size(const std::string& path);
std::vector<std::string> list_files_recursive(const std::string& root);

std::string join_path(const std::string& dir, const std::string& name);
std::string base_name(const std::string& path);

}  // namespace depot
