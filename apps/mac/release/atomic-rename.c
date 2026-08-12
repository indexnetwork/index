#if defined(__linux__)
#define _GNU_SOURCE
#endif

#include <errno.h>
#include <stdint.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>

#if defined(__APPLE__)
#include <fcntl.h>
#include <unistd.h>
#elif defined(__linux__)
#include <fcntl.h>
#include <linux/fs.h>
#include <sys/syscall.h>
#include <unistd.h>
#else
#error "atomic no-clobber rename is supported only on macOS and Linux"
#endif

static int rename_noreplace(const char *source, const char *destination) {
#if defined(__APPLE__)
  return renameatx_np(AT_FDCWD, source, AT_FDCWD, destination, RENAME_EXCL);
#elif defined(__linux__)
  return (int)syscall(SYS_renameat2, AT_FDCWD, source, AT_FDCWD, destination, RENAME_NOREPLACE);
#endif
}

static int report_rename_error(void) {
  const int saved_errno = errno;
  errno = saved_errno;
  perror("atomic no-clobber rename");
  return saved_errno == EEXIST ? 73 : 74;
}

static int parse_identity(const char *value, dev_t *device, ino_t *inode) {
  char *separator = NULL;
  char *end = NULL;
  errno = 0;
  const uintmax_t parsed_device = strtoumax(value, &separator, 10);
  if (errno != 0 || separator == value || *separator != ':') return -1;
  const uintmax_t parsed_inode = strtoumax(separator + 1, &end, 10);
  if (errno != 0 || end == separator + 1 || *end != '\0') return -1;
  *device = (dev_t)parsed_device;
  *inode = (ino_t)parsed_inode;
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 3) {
    if (rename_noreplace(argv[1], argv[2]) == 0) return 0;
    return report_rename_error();
  }
  if (argc == 5 && strcmp(argv[1], "--quarantine-exact") == 0) {
    dev_t expected_device;
    ino_t expected_inode;
    struct stat quarantined;
    if (parse_identity(argv[4], &expected_device, &expected_inode) != 0) {
      fputs("invalid directory identity\n", stderr);
      return 64;
    }
    if (rename_noreplace(argv[2], argv[3]) != 0) return report_rename_error();
    if (lstat(argv[3], &quarantined) != 0) {
      perror("stat quarantined directory");
      return 74;
    }
    if (quarantined.st_dev == expected_device && quarantined.st_ino == expected_inode && S_ISDIR(quarantined.st_mode)) return 0;
    if (rename_noreplace(argv[3], argv[2]) != 0) {
      fputs("refusing cleanup: different directory was quarantined and could not be restored\n", stderr);
      return 75;
    }
    fputs("refusing cleanup: promoted directory identity changed\n", stderr);
    return 76;
  }
  fputs("usage: atomic-rename SOURCE DESTINATION\n       atomic-rename --quarantine-exact SOURCE QUARANTINE DEVICE:INODE\n", stderr);
  return 64;
}
