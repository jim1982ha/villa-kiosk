// src/components/auth/SignInAgain.tsx
// The remote access sign-in expired (auth/remoteSignIn): the line that says so, red as every problem line, and the one
// button that signs in again.

import ProblemLine from "@/components/common/ProblemLine";
import { SIGN_IN_AGAIN, SIGN_IN_EXPIRED, signInAgain } from "@/auth/remoteSignIn";
import Button from "@/components/common/Button";

export default function SignInAgain({ className = "" }: { className?: string }) {
  return (
    <div className={`sign-in-again${className ? ` ${className}` : ""}`}>
      <ProblemLine>{SIGN_IN_EXPIRED}</ProblemLine>
      <Button onClick={signInAgain}>{SIGN_IN_AGAIN}</Button>
    </div>
  );
}
