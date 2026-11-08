import Ionicons from '@expo/vector-icons/Ionicons';
import { Switch } from 'react-native';

import { PressableScale, SettingsRow } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';

export function ToggleRow({ detail, disabled, icon, label, onValueChange, value }: { detail: string; disabled?: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onValueChange: (value: boolean) => void; value: boolean }) {
  const { colors } = useTheme();
  return (
    <SettingsRow
      accessory={
        /*
          Without a label VoiceOver announces only "switch, off": the row's
          text sits in a sibling view and is not read as part of the control.
        */
        <Switch
          accessibilityHint={detail}
          accessibilityLabel={label}
          disabled={disabled}
          ios_backgroundColor={colors.border}
          onValueChange={onValueChange}
          thumbColor={colors.surface}
          trackColor={{ false: colors.border, true: colors.accentText }}
          value={value}
        />
      }
      detail={detail}
      disabled={disabled}
      icon={icon}
      label={label}
    />
  );
}

export function InfoRow({ detail, icon, label }: { detail: string; icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return <SettingsRow detail={detail} icon={icon} label={label} />;
}

export function MenuRow({ detail, icon, label, onPress }: { detail?: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale accessibilityRole="button" onPress={onPress}>
      <SettingsRow accessory={<Ionicons color={colors.muted} name="chevron-forward" size={18} />} detail={detail} icon={icon} label={label} />
    </PressableScale>
  );
}
