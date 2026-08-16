#include "depot/core.h"

#include "files.hpp"
#include "json.hpp"

#include <cstdlib>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <string>
#include <thread>

namespace depot {
void transfer_run(const std::string& id, const std::string& from, const std::string& to, const std::string& op,
                  std::function<void(uint64_t, uint64_t, const char*, const char*)> const& report);
void transfer_cancel(const std::string& id);
}

namespace {

char* dup_str(const std::string& s) {
  auto* p = static_cast<char*>(std::malloc(s.size() + 1));
  if (!p) {
    return nullptr;
  }
  std::memcpy(p, s.c_str(), s.size() + 1);
  return p;
}

std::string entry_json(const depot::DirEntry& e) {
  using namespace depot::json;
  std::string s = "{";
  s += "\"name\":" + quote(e.name);
  s += ",\"path\":" + quote(e.path);
  s += ",\"isDir\":" + boolean(e.is_dir);
  s += ",\"size\":" + num(e.size);
  s += ",\"modified\":" + (e.modified ? num_i(*e.modified) : std::string("null"));
  s += ",\"ext\":" + quote(e.ext);
  s += ",\"source\":" + quote(e.source);
  s += "}";
  return s;
}

std::string place_json(const depot::Place& p) {
  using namespace depot::json;
  return "{\"name\":" + quote(p.name) + ",\"path\":" + quote(p.path) + ",\"kind\":" + quote(p.kind) + "}";
}

std::string handle(const std::string& method, const std::string& args) {
  using namespace depot::json;
  try {
    if (method == "getHome") {
      return ok(quote(depot::home_dir()));
    }
    if (method == "getPlaces") {
      auto places = depot::places();
      std::string arr = "[";
      for (size_t i = 0; i < places.size(); ++i) {
        if (i) {
          arr += ",";
        }
        arr += place_json(places[i]);
      }
      arr += "]";
      return ok(arr);
    }
    if (method == "listDir") {
      auto items = depot::list_dir(get_string(args, "path"));
      std::string arr = "[";
      for (size_t i = 0; i < items.size(); ++i) {
        if (i) {
          arr += ",";
        }
        arr += entry_json(items[i]);
      }
      arr += "]";
      return ok(arr);
    }
    if (method == "search") {
      auto items = depot::search(get_string(args, "root"), get_string(args, "query"),
                                 static_cast<size_t>(get_number(args, "limit", 400)));
      std::string arr = "[";
      for (size_t i = 0; i < items.size(); ++i) {
        if (i) {
          arr += ",";
        }
        arr += entry_json(items[i]);
      }
      arr += "]";
      return ok(arr);
    }
    if (method == "readText") {
      return ok(quote(depot::read_text(get_string(args, "path"), 2 * 1024 * 1024)));
    }
    if (method == "mkdir") {
      depot::mkdir_path(get_string(args, "path"));
      return ok("null");
    }
    if (method == "rename") {
      depot::rename_path(get_string(args, "from"), get_string(args, "to"));
      return ok("null");
    }
    if (method == "remove") {
      depot::remove_path(get_string(args, "path"));
      return ok("null");
    }
    if (method == "trash") {
      depot::trash_path(get_string(args, "path"));
      return ok("null");
    }
    if (method == "copy") {
      depot::copy_path(get_string(args, "from"), get_string(args, "to"));
      return ok("null");
    }
    if (method == "move") {
      depot::move_path(get_string(args, "from"), get_string(args, "to"));
      return ok("null");
    }
    if (method == "parent") {
      auto p = depot::parent_path(get_string(args, "path"));
      return ok(p ? quote(*p) : std::string("null"));
    }
    if (method == "diskUsage") {
      auto d = depot::disk_usage(get_string(args, "path"));
      std::string obj = "{\"total\":" + num(d.total) + ",\"free\":" + num(d.free) + ",\"mount\":" + quote(d.mount) + "}";
      return ok(obj);
    }
    if (method == "joinPath") {
      return ok(quote(depot::join_path(get_string(args, "dir"), get_string(args, "name"))));
    }
    return err("Unknown method: " + method);
  } catch (const std::exception& e) {
    return err(e.what());
  }
}

}  // namespace

extern "C" {

void depot_configure(const char* home, const char* trash) {
  depot::configure(home ? home : "", trash ? trash : "");
}

char* depot_call(const char* method, const char* args_json) {
  auto result = handle(method ? method : "", args_json ? args_json : "{}");
  return dup_str(result);
}

void depot_free(char* ptr) { std::free(ptr); }

void depot_cancel_transfer(const char* id) { depot::transfer_cancel(id ? id : ""); }

void depot_start_transfer(const char* id, const char* from, const char* to, const char* op, depot_transfer_cb cb,
                          void* user) {
  std::string sid = id ? id : "";
  std::string sfrom = from ? from : "";
  std::string sto = to ? to : "";
  std::string sop = op ? op : "copy";
  std::thread([sid, sfrom, sto, sop, cb, user]() {
    auto emit = [&](uint64_t moved, uint64_t total, const char* state, const char* error) {
      if (!cb) {
        return;
      }
      using namespace depot::json;
      std::string payload = "{\"id\":" + quote(sid) + ",\"moved\":" + num(moved) + ",\"total\":" + num(total) +
                            ",\"state\":" + quote(state ? state : "running");
      if (error) {
        payload += ",\"error\":" + quote(error);
      }
      payload += "}";
      cb(payload.c_str(), user);
    };
    try {
      depot::transfer_run(sid, sfrom, sto, sop, emit);
    } catch (const std::exception& e) {
      emit(0, 0, "error", e.what());
    }
  }).detach();
}

}  // extern "C"
