import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.photuna.app',
  appName: 'Photuna Booth',
  webDir: 'build',
  // iOS-specific config
  ios: {
    // Allow the web view to respect safe areas (notch, home indicator)
    contentInset: 'always',
    // Allow mixed content (http API calls during development)
    allowsLinkPreview: false,
  },
  plugins: {
    Camera: {
      // Permissions declared in ios/App/App/Info.plist
    },
    Preferences: {
      // Uses NSUserDefaults on iOS — scoped per appId automatically
    },
  },
  // During development, point to the local dev server instead of the build folder
  // Remove or comment out `server` for production builds
  // server: {
  //   url: 'http://YOUR_LAN_IP:3000',
  //   cleartext: true,
  // },
};

export default config;
