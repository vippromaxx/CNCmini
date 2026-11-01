"""Compile the actual firmware motion function on the host; no device access.

Run: python test/test_motion_pulses.py
Requires a host C++ compiler (g++, or the MSYS2 UCRT64 installation).
"""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MotionPulsesTest(unittest.TestCase):
    def test_emitted_steps_match_requested_path(self):
        compiler = shutil.which("g++")
        if not compiler:
            self.fail("Host g++ compiler required; add its bin directory to PATH")
        source = (ROOT / "src/main.cpp").read_text(encoding="utf-8")
        match = re.search(r"^void moveBresenham\([^\n]+\) \{.*?^\}", source, re.M | re.S)
        self.assertIsNotNone(match, "Cannot find firmware motion function")
        config = (ROOT / "include/config.h").read_text(encoding="utf-8")
        names = ["PIN_X_STEP", "PIN_X_DIR", "PIN_Y_STEP", "PIN_Y_DIR",
                 "INVERT_X_DIR", "INVERT_Y_DIR", "DEFAULT_SPEED", "MAX_SAFE_SPEED"]
        defines = []
        for name in names:
            define = re.search(rf"^#define {name} [^\n]+", config, re.M)
            self.assertIsNotNone(define, name)
            defines.append(define[0])
        with tempfile.TemporaryDirectory(prefix="cnc-motion-test-") as temp:
            temp_path = Path(temp)
            (temp_path / "motion_under_test.inc").write_text(match[0], encoding="utf-8")
            (temp_path / "motion_config.inc").write_text("\n".join(defines), encoding="utf-8")
            executable = temp_path / ("motion.exe" if os.name == "nt" else "motion")
            build = subprocess.run([compiler, "-std=c++17", "-O2", "-I", temp,
                                    str(ROOT / "test/motion_pulses.cpp"), "-o", str(executable)],
                                   capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            env = os.environ.copy()
            env["PATH"] = str(Path(compiler).parent) + os.pathsep + env.get("PATH", "")
            result = subprocess.run([str(executable)], env=env, capture_output=True, text=True)
            print(result.stdout, end="")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
