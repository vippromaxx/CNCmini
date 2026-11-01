import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Capacitor } from '@capacitor/core';

// Native code only adapts lifecycle/navigation. CNC commands stay in the shared web code.
if (Capacitor.isNativePlatform()) {
document.documentElement.classList.add('native-app');
const ui = () => window.MiniCncUI;
App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) ui()?.resume();
  else ui()?.suspend();
});
App.addListener('backButton', () => {
  if (ui()?.back()) return;
  ui()?.suspend();
  App.minimizeApp();
});
window.MiniCncNative = {
  openConfig: () => AppLauncher.openUrl({ url: 'http://192.168.4.1' })
};
}
