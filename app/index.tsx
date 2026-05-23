import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View } from 'react-native';
import 'react-native-get-random-values';

const DotBackground = ({ isDark }: { isDark: boolean }) => (
  <View style={styles.gridContainer} pointerEvents="none">
    {[...Array(120)].map((_, i) => (
      <View key={i} style={[styles.dot, { backgroundColor: isDark ? '#27272a' : '#d4d4d8' }]} />
    ))}
  </View>
);

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const theme = {
    bg: isDark ? '#09090b' : '#ffffff',
    textPrimary: isDark ? '#fafafa' : '#09090b',
    textSecondary: '#71717a',
    inputBg: isDark ? '#18181b' : '#f4f4f5',
    border: isDark ? '#27272a' : '#e4e4e7',
    accent: isDark ? '#ffffff' : '#000000',
    buttonText: isDark ? '#000000' : '#ffffff',
  };

  const handleSignIn = async () => {
    setLoading(true);

    const adminEmail = process.env.EXPO_PUBLIC_ADMIN_EMAIL;
    const adminPassword = process.env.EXPO_PUBLIC_ADMIN_PASSWORD;

    if (email === adminEmail && password === adminPassword) {
      router.replace('/(tabs)');
    } else {
      Alert.alert('Error', 'Invalid email or password');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <DotBackground isDark={isDark} />
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Welcome back</Text>
          <Text style={styles.subtitle}>Enter your details to access your account</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: theme.textPrimary }]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: focusedInput === 'Email' ? theme.accent : theme.border, color: theme.textPrimary }]}
              placeholder="name@company.com"
              placeholderTextColor="#a1a1aa"
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocusedInput('Email')}
              onBlur={() => setFocusedInput(null)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: theme.textPrimary }]}>Password</Text>
            <View style={[styles.passwordWrapper, { backgroundColor: theme.inputBg, borderColor: focusedInput === 'Password' ? theme.accent : theme.border }]}>
              <TextInput
                style={[styles.passwordInput, { color: theme.textPrimary }]}
                placeholder="••••••••"
                placeholderTextColor="#a1a1aa"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!isPasswordVisible}
                onFocus={() => setFocusedInput('Password')}
                onBlur={() => setFocusedInput(null)}
              />
              <TouchableOpacity onPress={() => setIsPasswordVisible(!isPasswordVisible)} style={styles.eyeIcon}>
                <Ionicons name={isPasswordVisible ? "eye-off-outline" : "eye-outline"} size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.button, { backgroundColor: theme.accent }]} 
            onPress={handleSignIn}
            disabled={loading}
          >
            <Text style={[styles.buttonText, { color: theme.buttonText }]}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gridContainer: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap', opacity: 0.6 },
  dot: { width: 2, height: 2, borderRadius: 1, margin: 18 },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 30 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, color: '#71717a', marginTop: 8 },
  form: { gap: 20 },
  fieldContainer: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500' },
  input: { height: 48, borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 16, fontSize: 15 },
  passwordWrapper: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 8, borderWidth: 1.5, paddingRight: 16 },
  passwordInput: { flex: 1, height: '100%', paddingHorizontal: 16, fontSize: 15 },
  eyeIcon: { padding: 4 },
  button: { height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});