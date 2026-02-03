import { Stack } from 'expo-router';

export default function QuizzesLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="quiz-hub" />
            <Stack.Screen name="[id]" />
        </Stack>
    );
}
