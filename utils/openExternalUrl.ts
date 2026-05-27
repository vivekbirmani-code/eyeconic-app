import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export async function openExternalUrl(url: string) {
  if (Platform.OS === 'web') {
    return Linking.openURL(url);
  }

  try {
    return await WebBrowser.openBrowserAsync(url);
  } catch (error) {
    console.error('Failed to open URL in app browser:', error);
    return Linking.openURL(url);
  }
}
