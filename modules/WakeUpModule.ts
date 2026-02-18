import { NativeModules } from 'react-native';

const { WakeUpModule } = NativeModules;

interface WakeUpModuleInterface {
    activate(): void;
}

export default WakeUpModule as WakeUpModuleInterface;
