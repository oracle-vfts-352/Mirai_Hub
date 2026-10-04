declare module "*.css";

interface Window {
  miraiSecureOS?: {
    isDesktop: boolean;
    sendSystemAlert: (message: string) => void;
    requestLocalBiometrics: () => Promise<boolean>;
  };
}