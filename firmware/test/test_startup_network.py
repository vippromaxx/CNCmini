"""Exercise the firmware's real setup and network functions with transport fixtures."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StartupNetworkTest(unittest.TestCase):
    def test_both_connections_required_before_control(self):
        compiler = shutil.which('g++')
        self.assertIsNotNone(compiler)
        source = (ROOT / 'src/main.cpp').read_text(encoding='utf-8')
        functions = []
        for name in ['connectWiFi', 'connectMqtt', 'connectControlNetwork', 'setup']:
            match = re.search(rf'^(?:bool|void) {name}\([^\n]*\) \{{.*?^\}}', source, re.M | re.S)
            if name == 'connectControlNetwork' and not match:
                continue  # Run the previous setup too: it must fail the same behavioral checks.
            self.assertIsNotNone(match, name)
            functions.append(match[0])
        with tempfile.TemporaryDirectory(prefix='cnc-startup-') as temp:
            directory = Path(temp)
            (directory / 'startup_under_test.inc').write_text('\n'.join(functions), encoding='utf-8')
            executable = directory / ('startup.exe' if os.name == 'nt' else 'startup')
            build = subprocess.run([compiler, '-std=c++17', '-O2', '-I', temp,
                                    str(ROOT / 'test/startup_network.cpp'), '-o', str(executable)],
                                   capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            env = os.environ.copy()
            env['PATH'] = str(Path(compiler).parent) + os.pathsep + env.get('PATH', '')
            result = subprocess.run([str(executable)], capture_output=True, text=True, env=env, timeout=10)
            print(result.stdout, end='')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
