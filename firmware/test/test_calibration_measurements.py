"""Run actual firmware calibration on the host, without connecting to the device."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CalibrationMeasurementsTest(unittest.TestCase):
    def test_measured_travel(self):
        compiler = shutil.which("g++")
        self.assertIsNotNone(compiler, "Host g++ compiler required")
        source = (ROOT / "src/main.cpp").read_text(encoding="utf-8")
        function = re.search(r"^(?:void|bool) setCalibrationLimit\([^\n]*\) \{.*?^\}", source, re.M | re.S)
        self.assertIsNotNone(function)
        config = (ROOT / "include/config.h").read_text(encoding="utf-8")
        defines = [re.search(rf"^#define {name} [^\n]+", config, re.M)[0]
                   for name in ["DEFAULT_X_LIMIT", "DEFAULT_Y_LIMIT", "CALIBRATION_SCHEMA_VERSION"]]
        accepts_measurements = int("float" in function[0].splitlines()[0])
        defines.append(f"#define CALIBRATION_ACCEPTS_MEASUREMENTS {accepts_measurements}")
        with tempfile.TemporaryDirectory(prefix="cnc-calibration-test-") as temp:
            path = Path(temp)
            save = re.search(r"^void saveCalibration\(\) \{.*?^\}", source, re.M | re.S)[0]
            origin = re.search(r"^void setCalibrationOrigin\(\) \{.*?^\}", source, re.M | re.S)[0]
            load = re.search(r'  const uint8_t calibrationVersion =.*?(?=  // Đọc góc servo)', source, re.S)[0]
            actual = save + "\n" + origin + "\n" + function[0] + "\nvoid loadCalibrationUnderTest() {\n" + load + "\n}"
            (path / "calibration_under_test.inc").write_text(actual, encoding="utf-8")
            (path / "calibration_config.inc").write_text("\n".join(defines), encoding="utf-8")
            executable = path / "calibration.exe"
            result = subprocess.run([compiler, "-std=c++17", "-O2", "-I", temp,
                                     str(ROOT / "test/calibration_measurements.cpp"),
                                     "-o", str(executable)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            env = os.environ.copy()
            env["PATH"] = str(Path(compiler).parent) + os.pathsep + env.get("PATH", "")
            result = subprocess.run([str(executable)], capture_output=True, text=True, env=env)
            print(result.stdout, end="")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
