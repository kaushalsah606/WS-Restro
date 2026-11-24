'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, ChefHat, Loader2, Shield, Users, CreditCard, UtensilsCrossed, ChefHatIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';

const authSchema = z.object({
  email: z.string().trim().email({ message: "Please enter a valid email address" }).max(255),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(72),
  fullName: z.string().trim().max(100).optional(),
});

type AuthFormData = z.infer<typeof authSchema>;
type AppRole = 'SUPER_ADMIN' | 'RESTAURANT_ADMIN' | 'BRANCH_MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN_STAFF';

const roleLabels: Record<AppRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  RESTAURANT_ADMIN: 'Restaurant Admin',
  BRANCH_MANAGER: 'Manager',
  CASHIER: 'Cashier',
  WAITER: 'Waiter',
  KITCHEN_STAFF: 'Kitchen Staff',
};

export default function Auth() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AppRole>('WAITER');
  const [activeTab, setActiveTab] = useState('signin');
  const router = useRouter();
  const { user, loading, signIn, signUp } = useAuth();
  const { toast } = useToast();

  // One-click demo logins. The backend only returns accounts when it runs with DEMO_MODE=true.
  const [demoAccounts, setDemoAccounts] = useState<{ role: string; label: string; email: string; password: string }[]>([]);
  useEffect(() => {
    apiClient
      .get('/auth/demo-accounts')
      .then((r) => setDemoAccounts(r.data?.data ?? []))
      .catch(() => setDemoAccounts([]));
  }, []);

  const loginAsDemo = async (account: { email: string; password: string }) => {
    form.setValue('email', account.email);
    form.setValue('password', account.password);
    setActiveTab('signin');
    await handleSignIn({ email: account.email, password: account.password });
  };

  const form = useForm<AuthFormData>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      email: '',
      password: '',
      fullName: '',
    },
  });

  useEffect(() => {
    if (!loading && user) {
      router.push('/');
    }
  }, [user, loading, router]);

  const handleSignIn = async (data: AuthFormData) => {
    setIsLoading(true);
    const { error } = await signIn(data.email, data.password);
    setIsLoading(false);
    if (!error) {
      router.push('/');
    }
  };

  const handleSignUp = async (data: AuthFormData) => {
    setIsLoading(true);
    const { error } = await signUp(data.email, data.password, data.fullName, selectedRole);
    setIsLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <div className="w-full max-w-md">
        {/* Auth Form */}
        <div className="max-w-md mx-auto">
          {/* Logo Section */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-3">
              <ChefHat className="w-7 h-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">RestoPOS</h1>
            <p className="text-muted-foreground text-sm">Restaurant Management System</p>
          </div>

          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-0">
              <CardTitle className="text-lg">Welcome</CardTitle>
              <CardDescription className="text-sm">Sign in or create a new account</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="signin">Sign In</TabsTrigger>
                  <TabsTrigger value="signup">Sign Up</TabsTrigger>
                </TabsList>

                <TabsContent value="signin">
                  <form onSubmit={form.handleSubmit(handleSignIn)} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="signin-email" className="text-sm">Email</Label>
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="your@email.com"
                        className="h-9"
                        {...form.register('email')}
                      />
                      {form.formState.errors.email && (
                        <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="signin-password" className="text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="signin-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          className="h-9 pr-10"
                          {...form.register('password')}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                      {form.formState.errors.password && (
                        <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                      )}
                    </div>

                    <Button type="submit" className="w-full h-9" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        'Sign In'
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form onSubmit={form.handleSubmit(handleSignUp)} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-name" className="text-sm">Full Name</Label>
                      <Input
                        id="signup-name"
                        type="text"
                        placeholder="John Doe"
                        className="h-9"
                        {...form.register('fullName')}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="signup-email" className="text-sm">Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="your@email.com"
                        className="h-9"
                        {...form.register('email')}
                      />
                      {form.formState.errors.email && (
                        <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="signup-password" className="text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="signup-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          className="h-9 pr-10"
                          {...form.register('password')}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                      {form.formState.errors.password && (
                        <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm">Role</Label>
                      <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as AppRole)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(roleLabels) as AppRole[]).map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleLabels[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button type="submit" className="w-full h-9" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Creating account...
                        </>
                      ) : (
                        'Create Account'
                      )}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>

              {demoAccounts.length > 0 && (
                <div className="mt-5 pt-4 border-t" data-testid="demo-accounts">
                  <p className="text-xs font-medium text-muted-foreground mb-2 text-center">
                    Demo mode – sign in with one click
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {demoAccounts.map((a) => (
                      <Button
                        key={a.email}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto py-2 flex-col items-start gap-0 text-left"
                        disabled={isLoading}
                        onClick={() => loginAsDemo(a)}
                      >
                        <span className="text-sm font-medium">{a.label}</span>
                        <span className="text-[10px] text-muted-foreground font-normal truncate max-w-full">{a.email}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
