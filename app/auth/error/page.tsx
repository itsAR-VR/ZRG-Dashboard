"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function AuthErrorPage() {
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  // Check if it's an expired link error
  const isExpiredError = message?.toLowerCase().includes("expired");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Authentication Error</CardTitle>
          <CardDescription>
            {isExpiredError 
              ? "Your verification link has expired" 
              : "Something went wrong during authentication"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div className="p-3 bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">{message}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {isExpiredError 
              ? "Email verification links expire after 24 hours. Please sign up again to receive a new link."
              : "Please try signing in again or contact support if the problem persists."
            }
          </p>
        </CardContent>
        <CardFooter className="flex justify-center gap-4">
          <Link href="/auth/login">
            <Button variant="outline">Back to Login</Button>
          </Link>
          {isExpiredError ? (
            <Link href="/auth/signup">
              <Button>
                <RefreshCw className="h-4 w-4 mr-2" />
                Sign Up Again
              </Button>
            </Link>
          ) : (
            <Link href="/auth/signup">
              <Button>Sign Up</Button>
            </Link>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
