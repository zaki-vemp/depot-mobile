#pragma once

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <sstream>
#include <string>
#include <vector>

namespace depot {
namespace json {

inline std::string escape(const std::string& in) {
  std::string out;
  out.reserve(in.size() + 8);
  for (unsigned char c : in) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

inline std::string quote(const std::string& s) { return "\"" + escape(s) + "\""; }

inline std::string ok(const std::string& data) { return "{\"ok\":true,\"data\":" + data + "}"; }

inline std::string err(const std::string& message) {
  return "{\"ok\":false,\"error\":" + quote(message) + "}";
}

inline std::string num(uint64_t n) { return std::to_string(n); }

inline std::string num_i(int64_t n) { return std::to_string(n); }

inline std::string boolean(bool v) { return v ? "true" : "false"; }

inline std::string null_or_num(int64_t n, bool present) {
  return present ? num_i(n) : "null";
}

/** Pull a JSON string value for `key` from a flat object. Empty if missing. */
inline std::string get_string(const std::string& src, const char* key) {
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = src.find(needle);
  if (pos == std::string::npos) {
    return {};
  }
  pos = src.find(':', pos + needle.size());
  if (pos == std::string::npos) {
    return {};
  }
  ++pos;
  while (pos < src.size() && std::isspace(static_cast<unsigned char>(src[pos]))) {
    ++pos;
  }
  if (pos >= src.size() || src[pos] != '"') {
    return {};
  }
  ++pos;
  std::string out;
  while (pos < src.size()) {
    char c = src[pos++];
    if (c == '\\' && pos < src.size()) {
      char n = src[pos++];
      switch (n) {
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        default:
          out += n;
          break;
      }
    } else if (c == '"') {
      break;
    } else {
      out += c;
    }
  }
  return out;
}

/** Pull a JSON number for `key` from a flat object. */
inline double get_number(const std::string& src, const char* key, double fallback = 0) {
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = src.find(needle);
  if (pos == std::string::npos) {
    return fallback;
  }
  pos = src.find(':', pos + needle.size());
  if (pos == std::string::npos) {
    return fallback;
  }
  ++pos;
  while (pos < src.size() && std::isspace(static_cast<unsigned char>(src[pos]))) {
    ++pos;
  }
  try {
    return std::stod(src.substr(pos, 32));
  } catch (...) {
    return fallback;
  }
}

/** Pull a JSON string array for `key` from a flat object (`"paths":["a","b"]`). */
inline std::vector<std::string> get_string_array(const std::string& src, const char* key) {
  std::vector<std::string> out;
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = src.find(needle);
  if (pos == std::string::npos) {
    return out;
  }
  pos = src.find('[', pos + needle.size());
  if (pos == std::string::npos) {
    return out;
  }
  ++pos;
  while (pos < src.size()) {
    while (pos < src.size() && (std::isspace(static_cast<unsigned char>(src[pos])) || src[pos] == ',')) {
      ++pos;
    }
    if (pos >= src.size() || src[pos] == ']') {
      break;
    }
    if (src[pos] != '"') {
      break;
    }
    ++pos;
    std::string item;
    while (pos < src.size()) {
      char c = src[pos++];
      if (c == '\\' && pos < src.size()) {
        char n = src[pos++];
        switch (n) {
          case 'n':
            item += '\n';
            break;
          case 'r':
            item += '\r';
            break;
          case 't':
            item += '\t';
            break;
          case '"':
            item += '"';
            break;
          case '\\':
            item += '\\';
            break;
          default:
            item += n;
            break;
        }
      } else if (c == '"') {
        break;
      } else {
        item += c;
      }
    }
    out.push_back(std::move(item));
  }
  return out;
}

inline bool get_bool(const std::string& src, const char* key, bool fallback = false) {
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = src.find(needle);
  if (pos == std::string::npos) {
    return fallback;
  }
  pos = src.find(':', pos + needle.size());
  if (pos == std::string::npos) {
    return fallback;
  }
  ++pos;
  while (pos < src.size() && std::isspace(static_cast<unsigned char>(src[pos]))) {
    ++pos;
  }
  if (src.compare(pos, 4, "true") == 0) {
    return true;
  }
  if (src.compare(pos, 5, "false") == 0) {
    return false;
  }
  return fallback;
}

}  // namespace json
}  // namespace depot
