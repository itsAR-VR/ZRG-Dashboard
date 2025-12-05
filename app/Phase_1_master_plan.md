# Phase I: GoHighLevel SMS & AI Engine (Cursor Master Plan)

**Context for Cursor:**
We are building a custom "Master Inbox" dashboard using Next.js 14, Supabase (PostgreSQL), and Prisma. 
The current goal is **Phase I MVP**: Building a robust backend to handle inbound SMS webhooks from GoHighLevel (GHL), classify them using OpenAI, and sync them to our database in real-time.

We are NOT using OAuth. We are using **GHL Private Integration Keys** stored in our database to allow dynamic multi-tenancy (adding new clients on the fly).

---

## 1. Database Schema Setup
**Copy/Paste this into Cursor first:**

> "I need to set up the database schema for our GHL SMS integration. 
>
> Please open `prisma/schema.prisma` and define the following models to handle multi-tenancy:
>
> 1.  **`Client` Model** (Stores API Keys per sub-account):
>     - `id`: String (UUID, PK)
>     - `name`: String
>     - `ghlLocationId`: String (Unique) - Used to identify which client sent the webhook.
>     - `ghlPrivateKey`: String - The generic API key for this sub-account.
>     - `workspaceId`: String - To group clients.
>     - `leads`: Relation to Lead[].
>
> 2.  **`Lead` Model**:
>     - `id`: String (UUID, PK)
>     - `ghlContactId`: String (Unique)
>     - `firstName`: String?
>     - `lastName`: String?
>     - `email`: String?
>     - `phone`: String?
>     - `status`: String (default 'new')
>     - `sentimentTag`: String? (e.g., 'Meeting Requested')
>     - `client`: Relation to Client.
>     - `messages`: Relation to Message[].
>
> 3.  **`Message` Model**:
>     - `id`: String (UUID, PK)
>     - `body`: String (Text)
>     - `direction`: String ('inbound' or 'outbound')
>     - `createdAt`: DateTime (default now)
>     - `lead`: Relation to Lead.
>
> After creating the schema, run `npx prisma db push` to sync it with Supabase."

---

## 2. Dynamic Client Management (Settings UI)
**Once the DB is ready, paste this to build the UI for adding keys:**

> "I need a UI to manage these GHL Clients dynamically so I don't have to touch the code to add a new workspace.
>
> 1.  **Server Actions:** Create `actions/client-actions.ts`.
>     - `getClients()`: Returns all clients from the DB.
>     - `createClient(data)`: Accepts name, locationId, and privateKey, and saves to the DB.
>
> 2.  **UI Component:** Create `components/dashboard/settings/integrations-manager.tsx`.
>     - Use a Card layout.
>     - List existing clients (show Name and Location ID).
>     - Add a simple Form to add a new client using the Server Action.
>     - Use Shadcn UI components (Input, Button, Card, Table) which are already in the project.
>
> 3.  **Integration:** Update `components/dashboard/settings-view.tsx` to render this new `IntegrationsManager` component inside the 'Integrations' tab."

---

## 3. The Webhook Logic Engine (The Core)
**This is the heavy lifter. Paste this to build the backend logic:**

> "Now I need the API route to handle the incoming SMS webhooks. Create `app/api/webhooks/ghl/sms/route.ts`.
>
> **Logic Requirements:**
> 1.  **Ingest:** It must accept a POST request from GHL. Extract `locationId` and `contactId` from the body.
> 2.  **Auth Lookup:** Query the `Client` table using the incoming `locationId`.
>     - If no client is found, return 404 (we only process registered clients).
>     - If found, use that client's `ghlPrivateKey` for all subsequent API calls.
> 3.  **Context Fetching:** Create a helper function to fetch conversation history from GHL.
>     - Endpoint: `https://services.leadconnectorhq.com/conversations/messages/export`
>     - Headers: `Authorization: Bearer [ghlPrivateKey]`, `Version: 2021-04-15`
>     - Params: `channel=SMS`, `contactId=[contactId]`
>     - Processing: Sort messages by date and format them into a transcript string (e.g., 'Lead: Hello\nAgent: Hi').
> 4.  **AI Analysis:** Send this transcript to OpenAI (gpt-4o-mini) to classify the sentiment.
>     - Tags: 'Meeting Requested', 'Not Interested', 'Information Requested', 'Blacklist'.
> 5.  **Save to DB:**
>     - Upsert the `Lead` record (save name/phone from webhook data).
>     - Save the *newest* incoming message to the `Message` table.
>     - Update the Lead's `sentimentTag` based on the AI result."

---

## 4. Real-Time Feed Connection
**Finally, connect the UI to the live data:**

> "Connect the `ConversationFeed` component to the real database.
>
> 1.  **Fetch Data:** Instead of `mockConversations`, fetch the list of Leads from Prisma, ordered by the most recent `Message` timestamp.
> 2.  **Real-Time:** Use `createClientComponentClient` from `@supabase/auth-helpers-nextjs` to listen for changes on the `Message` table.
>     - When a new message is inserted (via our webhook), automatically refresh the feed data.
> 3.  **Display:**
>     - Show the `sentimentTag` as a badge.
>     - Show the latest message preview.
>     - Clicking a card should set the `activeConversationId`."