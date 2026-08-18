#ifndef _XOPEN_SOURCE
#define _XOPEN_SOURCE 600
#endif
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include "depot/core.h"

#include "json.hpp"

#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <thread>

namespace {

struct Session {
  int master = -1;
  pid_t child = -1;
};

std::mutex g_mu;
std::map<std::string, Session> g_sessions;
depot_transfer_cb g_cb = nullptr;
void* g_user = nullptr;

std::string b64(const char* data, size_t len) {
  static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  size_t i = 0;
  while (i + 2 < len) {
    unsigned n = (static_cast<unsigned char>(data[i]) << 16) | (static_cast<unsigned char>(data[i + 1]) << 8) |
                 static_cast<unsigned char>(data[i + 2]);
    out.push_back(tbl[(n >> 18) & 63]);
    out.push_back(tbl[(n >> 12) & 63]);
    out.push_back(tbl[(n >> 6) & 63]);
    out.push_back(tbl[n & 63]);
    i += 3;
  }
  if (i < len) {
    unsigned n = static_cast<unsigned char>(data[i]) << 16;
    if (i + 1 < len) {
      n |= static_cast<unsigned char>(data[i + 1]) << 8;
    }
    out.push_back(tbl[(n >> 18) & 63]);
    out.push_back(tbl[(n >> 12) & 63]);
    out.push_back(i + 1 < len ? tbl[(n >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}

void emit(const std::string& json) {
  if (g_cb) {
    g_cb(json.c_str(), g_user);
  }
}

void close_session(Session& s) {
  if (s.master >= 0) {
    ::close(s.master);
    s.master = -1;
  }
  if (s.child > 0) {
    ::kill(s.child, SIGHUP);
    ::waitpid(s.child, nullptr, WNOHANG);
    s.child = -1;
  }
}

const char* shell_bin() {
  const char* env = std::getenv("SHELL");
  if (env && ::access(env, X_OK) == 0) {
    return env;
  }
  const char* cands[] = {"/system/bin/sh", "/bin/sh", "/bin/bash", "/bin/zsh"};
  for (auto* p : cands) {
    if (::access(p, X_OK) == 0) {
      return p;
    }
  }
  return "/system/bin/sh";
}

int open_pty_pair(int* master, int* slave) {
  *master = ::posix_openpt(O_RDWR | O_NOCTTY);
  if (*master < 0) {
    return -1;
  }
  if (::grantpt(*master) != 0 || ::unlockpt(*master) != 0) {
    ::close(*master);
    *master = -1;
    return -1;
  }
  char* name = ::ptsname(*master);
  if (!name) {
    ::close(*master);
    *master = -1;
    return -1;
  }
  *slave = ::open(name, O_RDWR | O_NOCTTY);
  if (*slave < 0) {
    ::close(*master);
    *master = -1;
    return -1;
  }
  return 0;
}

}  // namespace

extern "C" {

void depot_term_bind(depot_transfer_cb cb, void* user) {
  std::lock_guard<std::mutex> lock(g_mu);
  g_cb = cb;
  g_user = user;
}

void depot_term_open(const char* id, const char* cwd, int cols, int rows) {
  if (!id || !*id) {
    return;
  }
  std::string sid = id;
  int master = -1;
  int slave = -1;
  if (open_pty_pair(&master, &slave) != 0) {
    using namespace depot::json;
    emit("{\"kind\":\"exit\",\"id\":" + quote(sid) + ",\"code\":1}");
    return;
  }

  struct winsize ws {};
  ws.ws_col = static_cast<unsigned short>(cols > 0 ? cols : 80);
  ws.ws_row = static_cast<unsigned short>(rows > 0 ? rows : 24);
  ::ioctl(master, TIOCSWINSZ, &ws);

  pid_t pid = ::fork();
  if (pid < 0) {
    ::close(master);
    ::close(slave);
    using namespace depot::json;
    emit("{\"kind\":\"exit\",\"id\":" + quote(sid) + ",\"code\":1}");
    return;
  }
  if (pid == 0) {
    ::close(master);
    ::setsid();
    ::ioctl(slave, TIOCSCTTY, 0);
    ::dup2(slave, STDIN_FILENO);
    ::dup2(slave, STDOUT_FILENO);
    ::dup2(slave, STDERR_FILENO);
    if (slave > 2) {
      ::close(slave);
    }
    if (cwd && *cwd) {
      ::chdir(cwd);
    }
    ::setenv("TERM", "xterm-256color", 1);
    const char* sh = shell_bin();
    const char* base = std::strrchr(sh, '/');
    std::string dash = std::string("-") + (base ? base + 1 : sh);
    ::execl(sh, dash.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }
  ::close(slave);

  {
    std::lock_guard<std::mutex> lock(g_mu);
    auto prev = g_sessions.find(sid);
    if (prev != g_sessions.end()) {
      close_session(prev->second);
      g_sessions.erase(prev);
    }
    g_sessions.emplace(sid, Session{master, pid});
  }

  std::thread([sid, master, pid]() {
    char buf[4096];
    while (true) {
      ssize_t n = ::read(master, buf, sizeof(buf));
      if (n <= 0) {
        break;
      }
      using namespace depot::json;
      emit("{\"kind\":\"data\",\"id\":" + quote(sid) + ",\"chunk\":" + quote(b64(buf, static_cast<size_t>(n))) + "}");
    }
    int status = 0;
    ::waitpid(pid, &status, 0);
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    using namespace depot::json;
    emit("{\"kind\":\"exit\",\"id\":" + quote(sid) + ",\"code\":" + num_i(code) + "}");
    std::lock_guard<std::mutex> lock(g_mu);
    auto it = g_sessions.find(sid);
    if (it != g_sessions.end()) {
      it->second.master = -1;
      it->second.child = -1;
    }
  }).detach();
}

void depot_term_write(const char* id, const char* data) {
  if (!id || !data) {
    return;
  }
  std::lock_guard<std::mutex> lock(g_mu);
  auto it = g_sessions.find(id);
  if (it == g_sessions.end() || it->second.master < 0) {
    return;
  }
  ::write(it->second.master, data, std::strlen(data));
}

void depot_term_resize(const char* id, int cols, int rows) {
  if (!id) {
    return;
  }
  std::lock_guard<std::mutex> lock(g_mu);
  auto it = g_sessions.find(id);
  if (it == g_sessions.end() || it->second.master < 0) {
    return;
  }
  struct winsize ws {};
  ws.ws_col = static_cast<unsigned short>(cols > 0 ? cols : 80);
  ws.ws_row = static_cast<unsigned short>(rows > 0 ? rows : 24);
  ::ioctl(it->second.master, TIOCSWINSZ, &ws);
}

void depot_term_close(const char* id) {
  if (!id) {
    return;
  }
  std::lock_guard<std::mutex> lock(g_mu);
  auto it = g_sessions.find(id);
  if (it == g_sessions.end()) {
    return;
  }
  close_session(it->second);
  g_sessions.erase(it);
}

}  // extern "C"
