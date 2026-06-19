import { Text, View } from 'react-native';
import { supabase } from '../src/lib/supabase';

export default function Index() {
  // Touch the client so the module + env wiring is exercised by the bundler.
  const ready = Boolean(supabase);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Gym-App — Phase 0 foundation</Text>
      <Text style={{ marginTop: 8, opacity: 0.7 }}>
        Supabase client {ready ? 'initialised' : 'unavailable'}.
      </Text>
    </View>
  );
}
