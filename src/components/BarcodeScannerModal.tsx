// Barcode scanner modal for food logging (Slice G4). Wraps expo-camera's CameraView.
//
// RUNTIME: expo-camera ships INSIDE Expo Go (SDK 54), so the scanner works in Expo Go on a
// PHYSICAL device with no rebuild. A rebuild is only needed for a standalone / EAS / custom
// dev-client binary that predates the expo-camera dependency (its bundle lacks the native
// module). The iOS Simulator has no real camera, so it can't decode a barcode there.
// The camera content is wrapped in an error boundary + onMountError so a missing native
// module or a failed camera init degrades to an "unavailable" message instead of a silent
// black screen. The caller hides the entry button on web (no camera) — see app/food/add.tsx.
//
// Scanning a barcode shown on a screen is finicky; autofocus="on" + facing="back" make a
// real product barcode decode reliably.
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { Text, Button } from './ui';
import { theme } from '../theme';

class CameraErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('BarcodeScanner unavailable', String(err));
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.md }}>
      {children}
    </View>
  );
}

function ScannerBody({ onScanned }: { onScanned: (code: string) => void }) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [mountError, setMountError] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  if (!permission) {
    return <Centered><Text variant="body" muted>{t('common.loading')}</Text></Centered>;
  }
  if (!permission.granted) {
    return (
      <Centered>
        <Text variant="title" style={{ textAlign: 'center' }}>{t('food.scan.permissionTitle')}</Text>
        <Text variant="caption" muted style={{ textAlign: 'center' }}>{t('food.scan.permissionSub')}</Text>
        <Button title={t('food.scan.grant')} onPress={() => requestPermission()} />
      </Centered>
    );
  }
  if (mountError) {
    return (
      <Centered>
        <Text variant="title" color="#fff" style={{ textAlign: 'center' }}>{t('food.scan.unavailableTitle')}</Text>
        <Text variant="caption" muted style={{ textAlign: 'center' }}>{t('food.scan.unavailableSub')}</Text>
      </Centered>
    );
  }

  return (
    <CameraView
      style={{ flex: 1 }}
      facing="back"
      autofocus="on"
      active
      onMountError={() => setMountError(true)}
      barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
      onBarcodeScanned={({ data }) => {
        if (handled.current || !data) return;
        handled.current = true;
        onScanned(String(data));
      }}
    />
  );
}

export function BarcodeScannerModal({
  visible,
  onScanned,
  onClose,
}: {
  visible: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Remount ScannerBody each time the modal opens so the one-shot scan guard resets.
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (visible) setKey((k) => k + 1);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={{ flex: 1 }}>
          {visible ? (
            <CameraErrorBoundary
              fallback={
                <Centered>
                  <Text variant="title" color="#fff" style={{ textAlign: 'center' }}>
                    {t('food.scan.unavailableTitle')}
                  </Text>
                  <Text variant="caption" muted style={{ textAlign: 'center' }}>
                    {t('food.scan.unavailableSub')}
                  </Text>
                </Centered>
              }
            >
              <ScannerBody key={key} onScanned={onScanned} />
            </CameraErrorBoundary>
          ) : null}
        </View>
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm, backgroundColor: theme.colors.surface }}>
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            {t('food.scan.prompt')}
          </Text>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
