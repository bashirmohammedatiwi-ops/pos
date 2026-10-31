import type { CapacitorConfig } from '@capacitor/cli';

/* تطبيق فريق ديما الحياة: www = واجهة الموظفين والمدراء. */
const config: CapacitorConfig = {
  appId: 'com.deemaalhayat.team',
  appName: 'ديما الفريق',
  webDir: 'www',
  backgroundColor: '#241245',
  android: {
    // الخادم الحالي http على IP؛ يُزال بعد تفعيل HTTPS على النطاق
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: '#241245',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#241245',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
