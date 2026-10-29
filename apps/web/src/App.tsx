import { AuthProvider, useAuth } from "./auth/AuthContext";
import { DatabaseProvider, useDatabase } from "./db/DatabaseContext";
import { HomeScreen } from "./pages/HomeScreen";
import { OnboardingScreen } from "./pages/OnboardingScreen";
import { SignInScreen } from "./pages/SignInScreen";
import { StylePreview } from "./pages/StylePreview";

function AppShell() {
  const { status: dbStatus, error: dbError } = useDatabase();
  const { status: authStatus } = useAuth();

  if (dbStatus === "loading" || authStatus === "checking") {
    return null;
  }
  if (dbStatus === "error") {
    return <p role="alert">Could not open local storage: {dbError}</p>;
  }
  if (authStatus === "needs-setup" || authStatus === "awaiting-recovery-ack") {
    return <OnboardingScreen />;
  }
  if (authStatus === "needs-sign-in") {
    return <SignInScreen />;
  }
  return <HomeScreen />;
}

export function App() {
  // The one-page design-token preview from stage 1 stays reachable for reference without
  // cluttering the app's own navigation.
  if (new URLSearchParams(window.location.search).get("screen") === "style") {
    return <StylePreview />;
  }

  return (
    <DatabaseProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </DatabaseProvider>
  );
}
