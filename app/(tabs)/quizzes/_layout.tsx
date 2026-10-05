import { Stack } from 'expo-router';

export default function QuizzesLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="quiz-hub" />
            <Stack.Screen name="my-performance" />
            <Stack.Screen name="question-bank" />
            <Stack.Screen name="create-quiz" />
            <Stack.Screen name="edit-quiz" />
            <Stack.Screen name="import-quiz" />
            <Stack.Screen name="past-tests" />
            {/* Rank & Branch Predictor — native screens over the website
                server's predictor API (student CTA on the dashboard). */}
            <Stack.Screen name="rank-predictor" />
            <Stack.Screen name="rank-predictor-history" />
            <Stack.Screen name="retest-requests" />
            <Stack.Screen name="student-analytics" />
            {/* Phase 0 CV/ML feasibility spike — isolated test surface, no production entry point. */}
            <Stack.Screen name="proctoring-spike" />
            <Stack.Screen name="[id]" />
        </Stack>
    );
}
