"""Run the actual firmware's network/NVS/restart flow on the host (no device I/O)."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NetworkConfigTest(unittest.TestCase):
    def test_change_network_while_connected(self):
        compiler = shutil.which("g++")
        self.assertIsNotNone(compiler, "Host g++ compiler required")
        source = (ROOT / "src/main.cpp").read_text(encoding="utf-8")

        def function(name):
            match = re.search(rf"^(?:void|bool) {name}\([^\n]*\) \{{.*?^\}}", source, re.M | re.S)
            self.assertIsNotNone(match, f"Missing firmware function {name}")
            return match[0]

        reset = re.search(r'  if \(rest == "control/wifi/reset"\) \{\n(.*?)^  \}', source, re.M | re.S)
        self.assertIsNotNone(reset, "Missing real MQTT Wi-Fi reset handler")
        actual = "void saveConfig();\n" + "\n".join(function(name) for name in ["loadConfig", "saveConfig", "connectWiFi", "loop"])
        actual += "\nvoid requestConfigUnderTest() {\n" + reset[1] + "\n}\n"
        with tempfile.TemporaryDirectory(prefix="cnc-network-test-") as temp:
            directory = Path(temp)
            (directory / "network_under_test.inc").write_text(actual, encoding="utf-8")
            executable = directory / ("network.exe" if os.name == "nt" else "network")
            build = subprocess.run([compiler, "-std=c++17", "-O2", "-I", temp,
                                    str(ROOT / "test/network_config.cpp"), "-o", str(executable)],
                                   capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            env = os.environ.copy()
            env["PATH"] = str(Path(compiler).parent) + os.pathsep + env.get("PATH", "")
            result = subprocess.run([str(executable)], capture_output=True, text=True, env=env)
            print(result.stdout, end="")
            self.assertEqual(result.returncode, 0, "Network/NVS regression failed (see checks above)")


if __name__ == "__main__":
    unittest.main()
