import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken, AUTH_COOKIE_NAME } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import Company from '@/models/Company';
import LoginForm from './LoginForm';

export const instant = false;

export const metadata = {
  title: 'Sign In | Company Lead Tracker',
  description: 'Sign in to access your organization dashboard.',
};

export default async function LoginPage() {
  let destination = null;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (token) {
      const payload = await verifyToken(token);
      if (payload && payload.userId) {
        await connectToDatabase();
        const user = await User.findById(payload.userId).lean();

        if (user && user.status === 'active') {
          if (user.role === 'super_admin') {
            destination = '/dashboard/super-admin';
          } else if (user.role === 'company_admin' && user.companyId) {
            const company = await Company.findById(user.companyId).lean();
            if (company && company.status === 'approved') {
              destination = '/dashboard/company-admin';
            }
          }
        }
      }
    }
  } catch {
    destination = null;
  }

  if (destination) {
    redirect(destination);
  }

  return <LoginForm />;
}
