/**
 * Secure Super Admin Bootstrap Script
 *
 * Usage:
 *   node scripts/bootstrap-super-admin.js
 *   node scripts/bootstrap-super-admin.js --allow-additional
 *   node scripts/bootstrap-super-admin.js --reset-password
 *
 * CLI arguments:
 *   --email="admin@example.com"
 *   --password="YourSecurePassword"
 *   --name="Super Admin"
 *   --allow-additional    (allows creating an additional super admin when another super admin exists)
 *   --reset-password       (resets the password for this super admin if it already exists)
 *
 * Credentials default to SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, and SUPER_ADMIN_NAME in .env.local
 */

import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dns from 'node:dns';

// 1. Manually parse .env.local if not already in process.env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// 2. Configure robust public DNS fallback for MongoDB Atlas SRV resolution
try {
  const customResolver = new dns.promises.Resolver();
  customResolver.setServers(['8.8.8.8', '1.1.1.1']);

  const originalResolve = dns.promises.resolve.bind(dns.promises);
  dns.promises.resolve = async function (hostname, rrtype) {
    if (rrtype === 'SRV' || rrtype === 'TXT') {
      try {
        return await customResolver.resolve(hostname, rrtype);
      } catch {
        return await originalResolve(hostname, rrtype);
      }
    }
    return await originalResolve(hostname, rrtype);
  };
} catch {
  // Graceful fallback
}

// 3. Parse command-line flags
const args = process.argv.slice(2);
const cliArgs = {};
let allowAdditional = false;
let resetPassword = false;

for (const arg of args) {
  if (arg === '--allow-additional' || arg === '--force' || arg === '--allow-additional=true') {
    allowAdditional = true;
  } else if (arg === '--reset-password' || arg === '--reset' || arg === '--reset-password=true') {
    resetPassword = true;
  } else if (arg.startsWith('--')) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx).trim();
      const val = arg.slice(eqIdx + 1).trim();
      if (key && val) {
        cliArgs[key] = val;
      }
    }
  }
}

const email = cliArgs.email || process.env.SUPER_ADMIN_EMAIL;
const password = cliArgs.password || process.env.SUPER_ADMIN_PASSWORD;
const name = cliArgs.name || process.env.SUPER_ADMIN_NAME || 'Super Admin';
const envAllowAdditional = process.env.ALLOW_ADDITIONAL_SUPER_ADMIN === 'true';

async function bootstrap() {
  console.log('--- Super Admin Bootstrap Initialization ---');

  if (!email || !password) {
    console.error(
      'Error: Super Admin credentials missing.\n' +
      'Please supply credentials via .env.local (SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD)\n' +
      'or pass command-line arguments: --email="admin@example.com" --password="YourSecurePassword"'
    );
    process.exit(1);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+$/;
  const normalizedEmail = email.trim().toLowerCase();
  if (!emailRegex.test(normalizedEmail)) {
    console.error('Error: Invalid email format.');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Error: Super Admin password must be at least 8 characters long.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not set in environment or .env.local.');
    process.exit(1);
  }

  try {
    console.log('Connecting to database...');
    await mongoose.connect(mongoUri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`Connected to MongoDB successfully (database: ${mongoose.connection.name}).`);

    // Define schema inline if User model not registered
    const User =
      mongoose.models.User ||
      mongoose.model(
        'User',
        new mongoose.Schema(
          {
            name: { type: String, required: true },
            email: { type: String, required: true, unique: true },
            passwordHash: { type: String, required: true, select: true },
            role: { type: String, required: true },
            companyId: { type: mongoose.Schema.Types.ObjectId, default: null },
            status: { type: String, default: 'active' },
          },
          { timestamps: true }
        )
      );

    // Check if account with this specific email already exists
    const existingByEmail = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
    if (existingByEmail) {
      if (existingByEmail.role !== 'super_admin') {
        console.error(
          `Conflict: An account with email [${normalizedEmail}] already exists with role [${existingByEmail.role}]. Aborting.`
        );
        await mongoose.disconnect();
        process.exit(1);
      }

      if (resetPassword) {
        console.log('Resetting password for existing Super Admin...');
        const newHash = await bcrypt.hash(password, 10);
        existingByEmail.passwordHash = newHash;
        if (name) existingByEmail.name = name.trim();
        existingByEmail.status = 'active';
        await existingByEmail.save();

        console.log(`SUCCESS: Password for Super Admin [${normalizedEmail}] has been reset successfully.`);
        console.log('Role: super_admin | Status: active');
        await mongoose.disconnect();
        return;
      }

      // Check if current password matches
      const isMatch = await bcrypt.compare(password, existingByEmail.passwordHash);
      if (isMatch) {
        console.log(`Notice: Super Admin account [${normalizedEmail}] already exists and password matches configured credentials.`);
      } else {
        console.log(`Notice: Super Admin account [${normalizedEmail}] already exists, but its password does not match the configured credentials.`);
        console.log('To update the password to match configured credentials, run:');
        console.log('  node scripts/bootstrap-super-admin.js --reset-password');
        console.log('Or use the dedicated reset script:');
        console.log('  node scripts/reset-super-admin-password.js');
      }
      await mongoose.disconnect();
      return;
    }

    // Check if another Super Admin account exists
    const otherSuperAdmin = await User.findOne({ role: 'super_admin' });
    if (otherSuperAdmin && !allowAdditional && !envAllowAdditional) {
      console.log(
        `Notice: A Super Admin account already exists in this database (${otherSuperAdmin.email}).\n` +
        `The requested account [${normalizedEmail}] was not created because single-admin mode is the default.\n` +
        'To create this account as an additional Super Admin, re-run with:\n' +
        '  node scripts/bootstrap-super-admin.js --allow-additional\n' +
        'Or set ALLOW_ADDITIONAL_SUPER_ADMIN=true in .env.local.'
      );
      await mongoose.disconnect();
      return;
    }

    // Create Super Admin securely
    console.log('Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);

    const superAdmin = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'super_admin',
      companyId: null,
      status: 'active',
    });

    console.log(
      `SUCCESS: Super Admin [${superAdmin.name}] (${superAdmin.email}) created successfully.`
    );
    console.log('Role: super_admin | Status: active');
  } catch (error) {
    console.error('Bootstrap failed with error:', error.message || error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

bootstrap();
