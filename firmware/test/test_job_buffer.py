"""Exercise the real job parser and buffer lifecycle without device I/O."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class JobBufferTest(unittest.TestCase):
    def test_capacity_release_and_allocation_failure(self):
        compiler = shutil.which("g++")
        self.assertIsNotNone(compiler, "Host g++ compiler required")
        source = (ROOT / "src/main.cpp").read_text(encoding="utf-8")
        config = (ROOT / "include/config.h").read_text(encoding="utf-8")
        capacity = re.search(r"^#define JOB_MAX_OPS (\d+)", config, re.M)
        self.assertIsNotNone(capacity)
        job_type = re.search(r"^struct JobOp \{.*?^\};", source, re.M | re.S)
        self.assertIsNotNone(job_type)

        def function(name):
            match = re.search(rf"^(?:void|bool) {name}\([^\n]*\) \{{.*?^\}}", source, re.M | re.S)
            self.assertIsNotNone(match, f"Missing firmware function {name}")
            return match[0]

        harness = r'''
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <new>
#include <string>
using String = std::string;
bool failAllocation = false;
int allocations = 0, releases = 0;
void *operator new[](size_t size, const std::nothrow_t &) noexcept {
  ++allocations;
  return failAllocation ? nullptr : std::malloc(size);
}
void operator delete[](void *p) noexcept { if (p) ++releases; std::free(p); }
void operator delete[](void *p, size_t) noexcept { operator delete[](p); }
'''
        harness += "constexpr int JOB_MAX_OPS = " + capacity[1] + ";\n" + job_type[0]
        harness += "\nJobOp *job = nullptr; uint16_t jobCount = 0, jobIndex = 0;\n"
        harness += "\n".join(function(name) for name in [
            "prepareJobBuffer", "releaseJobBuffer", "addJobMove", "parseJobData"])
        harness += r'''
int main() {
  assert(prepareJobBuffer());
  assert(job[0].action == 'M' && job[JOB_MAX_OPS - 1].action == 'M');
  assert(prepareJobBuffer() && allocations == 1);
  parseJobData("U;D;12,34;-5,6;");
  assert(jobCount == 4 && job[0].action == 'U' && job[1].action == 'D');
  assert(job[2].x == 12 && job[2].y == 34 && job[3].x == -5);
  for (int i = jobCount; i < JOB_MAX_OPS; ++i) addJobMove(i, -i);
  parseJobData("U;D;99999,99999;");
  assert(jobCount == JOB_MAX_OPS && job[JOB_MAX_OPS - 1].x == JOB_MAX_OPS - 1);
  std::cout << "PASS full " << JOB_MAX_OPS << "-operation capacity, parser and overflow guard\n";
  jobIndex = 100;
  releaseJobBuffer();
  assert(job == nullptr && jobCount == 0 && jobIndex == 0 && releases == 1);
  releaseJobBuffer();
  assert(releases == 1);
  std::cout << "PASS release for AP mode and repeated release\n";
  failAllocation = true;
  assert(!prepareJobBuffer() && job == nullptr);
  failAllocation = false;
  assert(prepareJobBuffer());
  parseJobData("42,43;");
  assert(jobCount == 1 && job[0].x == 42 && job[0].y == 43);
  releaseJobBuffer();
  assert(releases == 2);
  std::cout << "PASS allocation failure and clean buffer on retry\n";
}
'''
        with tempfile.TemporaryDirectory(prefix="cnc-job-buffer-") as temp:
            directory = Path(temp)
            cpp = directory / "job_buffer.cpp"
            cpp.write_text(harness, encoding="utf-8")
            executable = directory / ("job_buffer.exe" if os.name == "nt" else "job_buffer")
            build = subprocess.run([compiler, "-std=c++17", "-O2", str(cpp), "-o", str(executable)],
                                   capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            env = os.environ.copy()
            env["PATH"] = str(Path(compiler).parent) + os.pathsep + env.get("PATH", "")
            result = subprocess.run([str(executable)], capture_output=True, text=True, env=env)
            print(result.stdout, end="")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
