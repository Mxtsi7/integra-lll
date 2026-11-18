import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { UsoAndroidNativo } from './usoAndroid';

export const usoAndroidNativo: UsoAndroidNativo | null = Platform.OS === 'android'
  ? requireOptionalNativeModule<UsoAndroidNativo>('UsoAndroid') : null;
