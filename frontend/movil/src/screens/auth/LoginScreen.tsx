import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { login, AuthError } from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

export default function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const { iniciarSesion } = useAuth();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!correo.trim()) {
      setError('Ingresa tu correo electrónico.');
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await login({ correo: correo.trim(), password });
      iniciarSesion({ access_token: res.access_token, refresh_token: res.refresh_token });
    } catch (err: unknown) {
      if (err instanceof AuthError && err.status === 401) {
        setError('Usuario o contraseña inválidos');
      } else if (err instanceof AuthError) {
        setError(err.message);
      } else if (err instanceof TypeError) {
        setError('No se pudo conectar con el servidor. Intenta de nuevo en un momento.');
      } else {
        setError('No se pudo iniciar sesión. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} testID="screen-login">
      <View style={styles.card}>
        <Text style={styles.titulo}>Bienvenido de nuevo</Text>
        <Text style={styles.subtitulo}>Entra para ver cómo van tus suscripciones.</Text>

        {error ? (
          <View style={styles.errorBox} testID="login-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.formGroup}>
          <Text style={styles.label}>Correo electrónico</Text>
          <TextInput
            testID="input-correo"
            style={styles.input}
            value={correo}
            onChangeText={(text) => {
              setCorreo(text);
              if (error) setError(null);
            }}
            placeholder="tu@correo.cl"
            placeholderTextColor="#94a3b8"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              testID="input-password"
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError(null);
              }}
              placeholder="Tu contraseña"
              placeholderTextColor="#94a3b8"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <Pressable
              testID="toggle-password"
              style={styles.eyeButton}
              onPress={() => setShowPassword((v) => !v)}
            >
              <Text style={styles.eyeButtonText}>{showPassword ? 'Ocultar' : 'Ver'}</Text>
            </Pressable>
          </View>
        </View>

        <NavButton
          testID="login-submit"
          title={loading ? 'Ingresando…' : 'Iniciar sesión'}
          onPress={handleLogin}
        />

        <View style={styles.divider} />

        <View style={styles.linksContainer}>
          <NavButton
            testID="go-registro"
            title="¿No tienes cuenta? Crea una"
            variant="secondary"
            onPress={() => navigation.navigate('Registro')}
          />
          <NavButton
            testID="go-recuperar"
            title="¿Olvidaste tu contraseña?"
            variant="secondary"
            onPress={() => navigation.navigate('RecuperarContrasena')}
          />
          <NavButton
            testID="go-verificar"
            title="Verificar correo"
            variant="secondary"
            onPress={() => navigation.navigate('VerificarCorreo')}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  titulo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitulo: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 64,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  eyeButtonText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 20,
  },
  linksContainer: {
    gap: 10,
  },
});
