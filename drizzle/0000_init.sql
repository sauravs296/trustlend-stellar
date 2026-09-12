CREATE TYPE "public"."app_role" AS ENUM('borrower', 'lender', 'admin');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'submitted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('requested', 'approved', 'funded', 'active', 'repaid', 'defaulted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pool_status" AS ENUM('active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'qualified', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."risk_decision" AS ENUM('allow', 'manual_review', 'reject');--> statement-breakpoint
CREATE TYPE "public"."risk_status" AS ENUM('low', 'medium', 'high', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."task_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'assigned', 'completed', 'verified', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'confirmed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "chain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" text NOT NULL,
	"contract_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"happened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"verification_type" text NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"payload_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"severity" smallint NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'XLM' NOT NULL,
	"status" "tx_status" DEFAULT 'pending' NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lending_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "pool_status" DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'XLM' NOT NULL,
	"apr_bps" integer NOT NULL,
	"total_liquidity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"available_liquidity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_borrowed" numeric(20, 6) DEFAULT '0' NOT NULL,
	"borrow_cap" numeric(20, 7),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_fundings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"lender_id" uuid NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"tx_hash" text NOT NULL,
	"lender_address" text,
	"funded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tx_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"borrower_id" uuid NOT NULL,
	"pool_id" uuid,
	"status" "loan_status" DEFAULT 'requested' NOT NULL,
	"principal_amount" numeric(20, 6) NOT NULL,
	"apr_bps" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"rate_model" text DEFAULT 'fixed' NOT NULL,
	"rate_switch_count" integer DEFAULT 0 NOT NULL,
	"last_rate_switch_at" timestamp with time zone,
	"funded_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"repaid_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"funded_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"defaulted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"lender_id" uuid NOT NULL,
	"status" "position_status" DEFAULT 'active' NOT NULL,
	"principal_amount" numeric(20, 6) NOT NULL,
	"earned_interest" numeric(20, 6) DEFAULT '0' NOT NULL,
	"withdrawn_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"role" "app_role" DEFAULT 'borrower' NOT NULL,
	"wallet_address" text,
	"country_code" text,
	"phone" text,
	"date_of_birth" date,
	"kyc_status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"risk_status" "risk_status" DEFAULT 'medium' NOT NULL,
	"government_id_ipfs_hash" text,
	"government_id_url" text,
	"kyc_submitted_at" timestamp with time zone,
	"kyc_verified_at" timestamp with time zone,
	"kyc_rejection_reason" text,
	"kyc_provider_id" text,
	"kyc_provider_status" text,
	"regulated_pool_access" boolean DEFAULT false NOT NULL,
	"referral_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"referral_code" text NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"qualifying_loan_id" uuid,
	"bonus_amount" numeric(20, 7) DEFAULT '0' NOT NULL,
	"payout_tx_hash" text,
	"qualified_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_key" text,
	"points_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_snapshots" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"score_total" integer DEFAULT 0 NOT NULL,
	"repayment_score" integer DEFAULT 0 NOT NULL,
	"lending_score" integer DEFAULT 0 NOT NULL,
	"consistency_score" integer DEFAULT 0 NOT NULL,
	"external_score" integer DEFAULT 0 NOT NULL,
	"reputation_level" text DEFAULT 'bronze' NOT NULL,
	"score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"decision" "risk_decision" NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"assigned_to" uuid,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"reward_xlm" numeric(20, 6) DEFAULT '0' NOT NULL,
	"difficulty" "task_difficulty" DEFAULT 'easy' NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"completion_deadline" timestamp with time zone,
	"completion_date" timestamp with time zone,
	"proof_submission" text,
	"creator_rating" smallint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"role" "app_role" DEFAULT 'borrower' NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"platform" text NOT NULL,
	"topic" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_verifications" ADD CONSTRAINT "external_verifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending_pools" ADD CONSTRAINT "lending_pools_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_fundings" ADD CONSTRAINT "loan_fundings_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_fundings" ADD CONSTRAINT "loan_fundings_lender_id_profiles_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_payer_id_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrower_id_profiles_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_pool_id_lending_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."lending_pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_positions" ADD CONSTRAINT "pool_positions_pool_id_lending_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."lending_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_positions" ADD CONSTRAINT "pool_positions_lender_id_profiles_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_profiles_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_profiles_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_qualifying_loan_id_loans_id_fk" FOREIGN KEY ("qualifying_loan_id") REFERENCES "public"."loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_snapshots" ADD CONSTRAINT "reputation_snapshots_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_events_tx_hash_event_type_key" ON "chain_events" USING btree ("tx_hash","event_type");--> statement-breakpoint
CREATE INDEX "idx_chain_events_contract_id" ON "chain_events" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_chain_events_happened_at" ON "chain_events" USING btree ("happened_at");--> statement-breakpoint
CREATE INDEX "idx_external_verifications_user_id" ON "external_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_external_verifications_status" ON "external_verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fraud_signals_user_id_created_at" ON "fraud_signals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_fraud_signals_resolved" ON "fraud_signals" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_user_id_created_at" ON "ledger_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_status" ON "ledger_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lending_pools_status" ON "lending_pools" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lending_pools_status_available" ON "lending_pools" USING btree ("status","available_liquidity");--> statement-breakpoint
CREATE INDEX "idx_lending_pools_created_at_desc" ON "lending_pools" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_loan_fundings_loan_id" ON "loan_fundings" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_loan_fundings_lender_id" ON "loan_fundings" USING btree ("lender_id");--> statement-breakpoint
CREATE INDEX "idx_loan_fundings_lender_loan" ON "loan_fundings" USING btree ("lender_id","loan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_loan_fundings_tx_hash" ON "loan_fundings" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_loan_repayments_loan_id" ON "loan_repayments" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_loan_repayments_payer_id" ON "loan_repayments" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "idx_loans_borrower_id" ON "loans" USING btree ("borrower_id");--> statement-breakpoint
CREATE INDEX "idx_loans_pool_id" ON "loans" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_loans_status" ON "loans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_loans_due_at" ON "loans" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "idx_loans_borrower_status" ON "loans" USING btree ("borrower_id","status");--> statement-breakpoint
CREATE INDEX "idx_loans_rate_model" ON "loans" USING btree ("rate_model");--> statement-breakpoint
CREATE INDEX "idx_loans_status_funded" ON "loans" USING btree ("status","funded_amount");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_id_created_at" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pool_positions_lender_id" ON "pool_positions" USING btree ("lender_id");--> statement-breakpoint
CREATE INDEX "idx_pool_positions_pool_id" ON "pool_positions" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_profiles_role" ON "profiles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_profiles_wallet_address" ON "profiles" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_profiles_kyc_status" ON "profiles" USING btree ("kyc_status");--> statement-breakpoint
CREATE INDEX "idx_profiles_risk_status" ON "profiles" USING btree ("risk_status");--> statement-breakpoint
CREATE INDEX "idx_profiles_kyc_submitted_at" ON "profiles" USING btree ("kyc_submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_referral_code_key" ON "profiles" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_profiles_kyc_provider_id" ON "profiles" USING btree ("kyc_provider_id") WHERE "profiles"."kyc_provider_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_profiles_regulated_pool_access" ON "profiles" USING btree ("regulated_pool_access");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_id_key" ON "referrals" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_referrer_id" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_status" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_referrals_referrer_status" ON "referrals" USING btree ("referrer_id","status");--> statement-breakpoint
CREATE INDEX "idx_rep_events_user_id_created_at" ON "reputation_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_rep_events_source" ON "reputation_events" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_rep_events_source_key" ON "reputation_events" USING btree ("source_type","source_key");--> statement-breakpoint
CREATE INDEX "idx_risk_assessments_user_id_assessed_at" ON "risk_assessments" USING btree ("user_id","assessed_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_creator_id" ON "tasks" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned_to" ON "tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_created_at" ON "tasks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_platform" ON "webhook_endpoints" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_topic" ON "webhook_endpoints" USING btree ("topic");