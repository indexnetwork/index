UPDATE "users" SET "onboarding" = (
  ("onboarding"::jsonb - 'firstSignalIntentId')
  || CASE WHEN "onboarding"::jsonb ? 'firstSignalIntentId'
       THEN jsonb_build_object('firstIntentId', "onboarding"::jsonb->'firstSignalIntentId') ELSE '{}'::jsonb END
  || CASE WHEN "onboarding"::jsonb->>'currentStep' = 'first_signal'
       THEN '{"currentStep":"first_intent"}'::jsonb ELSE '{}'::jsonb END
)::json
WHERE "onboarding"::jsonb ? 'firstSignalIntentId' OR "onboarding"::jsonb->>'currentStep' = 'first_signal';
--> statement-breakpoint
UPDATE "opportunities" SET "interpretation" = ("interpretation" - 'signals') || jsonb_build_object('intents', "interpretation"->'signals')
WHERE "interpretation" ? 'signals';
