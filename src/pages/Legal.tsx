import React from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, EyeOff, UserCheck, Scale, Calendar } from 'lucide-react';
import { Link } from 'react-router';

export default function Legal() {
  return (
    <div className="min-h-screen bg-[#121317] text-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-bold tracking-tight mb-4">Terms of Service & Privacy Policy</h1>
          <p className="text-gray-400">Simple, transparent, and secure.</p>
        </motion.div>

        <div className="space-y-8">
          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#1c172d]/40 backdrop-blur-md border border-white/5 rounded-3xl p-8"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-semibold">Privacy & Encryption</h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              GlassExpense is built so that we cannot read your financial data. Job titles, clients, notes, expense amounts and
              descriptions, tags, wishlists, recurring entries, tax settings, W-2 details and receipt images are encrypted in your
              browser with keys we never see. <strong>Only you and the people you invite can decrypt them.</strong>
              <br /><br />
              <strong>What our servers can see:</strong> your username and email address, your plan, each job's start and end dates
              (needed for the calendar), when records were created and how many there are, and which accounts share a job.
              <br /><br />
              <strong>Optional features change this.</strong> Turning on background Google Calendar sync lets our server read job titles
              and dates (and Google sees them). Turning on “reports with figures” lets our server read a small summary of daily totals per
              job and category (never individual entries) to write your report e-mails; those figures then travel by e-mail. Both can be turned off at any time. Using a cloud AI provider for receipt scanning sends that receipt image to the provider
              you configured; on-device scanning never leaves your device. If you lose both your password and your 12-word recovery
              phrase, nobody, including us, can recover your data. Your data is yours alone and is never sold.
            </p>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#1c172d]/40 backdrop-blur-md border border-white/5 rounded-3xl p-8"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <EyeOff className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-semibold">Data Collection</h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              We do not engage in broad data collection or selling of user information. The only information we are able to see 
              and store are basic account credentials:
            </p>
            <ul className="mt-4 space-y-2 text-gray-400 list-disc list-inside">
              <li>Your chosen username</li>
              <li>Your email address (for account recovery and essential notifications)</li>
            </ul>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-[#1c172d]/40 backdrop-blur-md border border-white/5 rounded-3xl p-8"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-[#7c3bed]/10 flex items-center justify-center text-[#7c3bed]">
                <UserCheck className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-semibold">User Conduct</h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              Users are expected to use GlassExpense for its intended purpose: tracking expenses and managing budgets. 
              Any attempt to use the application for illegal activities, malicious intent, or anything outside of its 
              functional scope is strictly prohibited and may result in account termination.
            </p>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-[#1c172d]/40 backdrop-blur-md border border-white/5 rounded-3xl p-8"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                <Calendar className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-semibold">Google OAuth & Data Usage</h2>
            </div>
            <div className="text-gray-300 leading-relaxed space-y-6">
              <p>
                GlassExpense provides an optional integration with Google Calendar to help you synchronize your budgets and project timelines with your personal or professional schedule. To comply with the Google API Services User Data Policy, we disclose our data access, usage, sharing, storage, and retention policies below.
              </p>

              <div>
                <h3 className="text-lg font-medium text-white mb-2">1. Data Accessed</h3>
                <p className="text-gray-400 mb-2">
                  When you authenticate and link your Google Account, GlassExpense requests the following specific permissions:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-400 pl-2">
                  <li><code className="text-purple-400">.../auth/calendar.events</code>: Used to create, view, edit, and delete calendar events for projects and expenses that you choose to sync.</li>
                  <li><code className="text-purple-400">.../auth/calendar.readonly</code>: Used to list your calendars to help you select which specific calendar to sync to.</li>
                </ul>
                <p className="text-gray-400 mt-2">
                  We only access your Google calendar list and events. We do not access your personal profile, emails, contacts, or other Google account data.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-medium text-white mb-2">2. Data Usage & Purpose</h3>
                <p className="text-gray-400">
                  We access and use your Google Calendar data exclusively to perform user-initiated sync actions:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-400 pl-2 mt-2">
                  <li>Create calendar events reflecting your active Job/Project durations (start and end dates).</li>
                  <li>Optionally sync individual logged expenses as calendar entries (when toggled on).</li>
                  <li>Automatically update or delete corresponding calendar events when those items are modified or deleted inside the GlassExpense application.</li>
                </ul>
                <p className="text-gray-400 mt-2">
                  We do not scan, read, or process any pre-existing or unrelated events in your Google Calendar.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-medium text-white mb-2">3. Data Sharing</h3>
                <p className="text-gray-400">
                  <strong>We do not share your Google user data with any third parties</strong> under any circumstances. Stored OAuth tokens are never exposed or shared with third-party service providers, advertisers, or other entities. All data interactions are performed directly between the client, our secure backend server, and Google's API servers.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-medium text-white mb-2">4. Data Storage & Protection</h3>
                <p className="text-gray-400">
                  To facilitate automated background synchronization of your budgets, Google OAuth refresh tokens are stored securely in our database. We protect this data using industry-standard security measures, and all API communications are transmitted exclusively over encrypted HTTPS connections.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-medium text-white mb-2">5. Data Retention & Deletion</h3>
                <p className="text-gray-400 mb-2">
                  Google Calendar OAuth tokens and settings are retained only as long as you keep your Google account linked to GlassExpense:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-400 pl-2">
                  <li><strong>Instant Disconnection:</strong> You can disconnect your Google Calendar at any time by clicking "Disconnect" on the Settings page. This immediately and permanently purges your Google OAuth tokens and synchronization preferences from our database.</li>
                  <li><strong>Account Deletion:</strong> Deleting your GlassExpense account permanently deletes all associated user data, including all stored Google tokens and sync credentials.</li>
                  <li><strong>Manual Deletion Requests:</strong> For account deletion requests or inquiries regarding your data, you can contact us at <a href="mailto:support@futurelabz.dev" className="text-blue-400 hover:underline">support@futurelabz.dev</a>.</li>
                </ul>
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-[#1c172d]/40 backdrop-blur-md border border-white/5 rounded-3xl p-8"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                <Scale className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-semibold">Basic Terms</h2>
            </div>
            <p className="text-gray-300 leading-relaxed">
              By using GlassExpense, you agree to these simple principles. We reserve the right to update these terms 
              as the application evolves, but our commitment to your privacy and data encryption will remain unchanged.
            </p>
          </motion.section>
        </div>

        <div className="mt-12 text-center flex justify-center gap-8">
          <Link to="/" className="text-gray-500 hover:text-white transition-colors text-sm">
            Back to Home
          </Link>
          <Link to="/dashboard" className="text-gray-500 hover:text-white transition-colors text-sm">
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
