# Monthly Tracker — Firestore Security Specification

## 1. Data Invariants

1. **Identity & Ownership Isolation (`users/{uid}`)**:
   - Every user profile document ID `{uid}` must strictly match `request.auth.uid` and `data.uid`.
   - `users/{uid}` contains PII (`email`, `phoneNumber`, `displayName`) and is strictly readable (`get`) and writable only by the owner (`request.auth.uid == uid`). Collection-wide `list` queries on `/users` are strictly forbidden (`allow list: if false`).
2. **Master Gate Relational Sync**:
   - A `Tracker` at `/users/{uid}/trackers/{trackerId}` cannot be created, read (`get`), updated, or deleted unless the parent `/users/{uid}` document exists and belongs to `request.auth.uid`.
   - A `DailyRecord` at `/users/{uid}/trackers/{trackerId}/dailyRecords/{dateId}` cannot be created, read (`get`), updated, or deleted unless the parent `/users/{uid}/trackers/{trackerId}` document exists and its `uid` equals `request.auth.uid`.
   - An `ExpenseRecord` at `/users/{uid}/expenses/{expenseId}` cannot be created unless both `/users/{uid}` and `/users/{uid}/trackers/{incoming().trackerId}` exist and belong to `request.auth.uid`.
   - A `UserSettings` document at `/users/{uid}/settings/{settingId}` cannot be created, read (`get`), updated, or deleted unless `/users/{uid}` exists and belongs to `request.auth.uid`.
3. **Strict Schema, Volumetric & Key Enforcement**:
   - Every `create` and `update` operation must pass `isValid[Entity](incoming())`, enforcing exact key allowlists (`hasAll` and `hasOnly`), string `.size()` bounds, regex patterns on IDs and dates (`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`), and numeric constraints.
   - Every `update` operation must use the Action-Based Update Pattern with `incoming().diff(existing()).affectedKeys().hasOnly(...)` and preserve immutable fields (`uid`, `trackerId`, `expenseId`, `settingId`, `date`, `createdAt`).
4. **Temporal Integrity**:
   - On `create`, `incoming().createdAt == request.time && incoming().updatedAt == request.time`.
   - On `update`, `incoming().createdAt == existing().createdAt && incoming().updatedAt == request.time`.
5. **Query Enforcer on `list`**:
   - Every `allow list` rule enforces `isSignedIn() && request.auth.uid == uid && resource.data.uid == request.auth.uid` with zero `get()`/`exists()` calls inside `list`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Identity Spoofing on User Profile Create)**:
   Authenticated as `user_A`, attempting to create `/users/user_A` with `{ "uid": "user_B", ... }`. -> `PERMISSION_DENIED`
2. **Payload 2 (Cross-User PII Read)**:
   Authenticated as `user_B`, attempting `get` on `/users/user_A`. -> `PERMISSION_DENIED`
3. **Payload 3 (Shadow Field Injection on Tracker Create)**:
   Authenticated as `user_A`, creating `/users/user_A/trackers/t1` with `{ ..., "isVerified": true }`. -> `PERMISSION_DENIED`
4. **Payload 4 (Orphaned Tracker Create without Parent User Document)**:
   Authenticated as `user_no_profile`, creating `/users/user_no_profile/trackers/t1` when `/users/user_no_profile` does not exist. -> `PERMISSION_DENIED`
5. **Payload 5 (ID Poisoning / Oversized Document ID)**:
   Creating `/users/user_A/trackers/invalid$id!@#` with invalid characters. -> `PERMISSION_DENIED`
6. **Payload 6 (Value Poisoning on Update)**:
   Updating `/users/user_A/trackers/t1` with `name` set to a 5,000-character string or boolean. -> `PERMISSION_DENIED`
7. **Payload 7 (Immutable Field Mutation on Update)**:
   Updating `/users/user_A/trackers/t1` while changing `createdAt` or `trackerId`. -> `PERMISSION_DENIED`
8. **Payload 8 (Client Timestamp Forgery)**:
   Creating a `DailyRecord` where `createdAt` is a past or future timestamp instead of `request.time`. -> `PERMISSION_DENIED`
9. **Payload 9 (Date Key Mismatch on DailyRecord)**:
   Creating `/users/user_A/trackers/t1/dailyRecords/2026-10-25` with `{ "date": "2026-10-26", ... }`. -> `PERMISSION_DENIED`
10. **Payload 10 (Negative or Excessive Expense Amount)**:
    Creating `/users/user_A/expenses/exp1` with `{ "amount": -500, ... }`. -> `PERMISSION_DENIED`
11. **Payload 11 (Unbounded Array Injection on UserSettings)**:
    Updating `/users/user_A/settings/preferences` with `excludedWeekdays: [0, 1, 2, 3, 4, 5, 6, 7, 8]`. -> `PERMISSION_DENIED`
12. **Payload 12 (Unauthorized Cross-User List Query)**:
    Authenticated as `user_B`, executing a `list` query on `/users/user_A/expenses`. -> `PERMISSION_DENIED`
