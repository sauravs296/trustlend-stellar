import { GlobalErrorBoundary } from "@/components/dashboard/GlobalErrorBoundary"
import { RpcHealthProvider } from "@/components/RpcHealthProvider"
import { ReferralCapture } from "@/components/dashboard/ReferralCapture"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <GlobalErrorBoundary>
      <RpcHealthProvider>
        {/* Attributes a `?ref=` visit once the user has a session (Issue #266).
            Renders nothing and fails silently. */}
        <ReferralCapture />
        {children}
      </RpcHealthProvider>
    </GlobalErrorBoundary>
  )
}
