import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tripsitter.app',
  appName: 'TripSitter',
  webDir: 'public'
  server: {
  url: "back-line.vercel.app",
  cleartext: false
}
};



export default config;
