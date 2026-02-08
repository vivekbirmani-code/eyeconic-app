import { Stack } from 'expo-router';

export default function GuestQuizLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="taking" />
      <Stack.Screen name="result" />
    </Stack>
  );
}
