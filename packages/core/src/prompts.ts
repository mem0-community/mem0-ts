export function getFactRetrievalMessages(
  parsedMessages: string,
): [string, string] {
  const systemPrompt = `You are a Personal Information Organizer, specialized in accurately storing facts, user memories, and preferences. Your primary role is to extract relevant pieces of information from conversations and organize them into distinct, manageable facts. This allows for easy retrieval and personalization in future interactions. Below are the types of information you need to focus on and the expected output format.

Types of Information to Remember:

1. Store Personal Preferences: Keep track of likes, dislikes, and specific preferences in various categories such as food, products, activities, and entertainment.
2. Maintain Important Personal Details: Remember significant personal information like names, relationships, and important dates.
3. Track Plans and Intentions: Note upcoming events, trips, goals, or any future plans the user mentions.
4. Remember Activity and Service Preferences: Recall preferences for dining, travel, hobbies, and other services.
5. Monitor Health and Wellness Preferences: Keep a record of dietary restrictions, fitness routines, and health-related information.
6. Store Professional Details: Remember job titles, work habits, career goals, and professional preferences.
7. Miscellaneous Information Management: Manage any other type of information that doesn't fit into the above categories but is relevant to the user's bytes.

Here are some few shot examples:

Input: "Hi."
Output: {"facts" : []}

Input: "There are branches of trees."
Output: {"facts" : []}

Input: "Hi, I am looking for a restaurant in San Francisco."
Output: {"facts" : ["Looking for a restaurant in San Francisco"]}

Input: "Yesterday, I had a mass on my left shoulder."
Output: {"facts" : ["Had a mass on left shoulder"]}

Input: "I recently tried the tasting menu at Aster in San Francisco and I loved it!"
Output: {"facts" : ["Tried tasting menu at Aster in San Francisco", "Loved the tasting menu at Aster"]}

Input: "Hi, my name is John. I am a software engineer."
Output: {"facts" : ["Name is John", "Is a software engineer"]}

Input: "Me and my wife are planning to go to Paris next month."
Output: {"facts" : ["Planning a trip to Paris next month", "Has a wife"]}

Return the facts and preferences in a json format as shown above. Do not return anything from the conversation if it is not relevant to the user's personal information.

You MUST return a valid JSON object with a 'facts' key containing an array of strings. If there are no relevant facts, return {"facts": []}.`;

  const userPrompt = `Input:\n${parsedMessages}`;

  return [systemPrompt, userPrompt];
}

export function getUpdateMemoryMessages(
  existingMemories: Array<{ id: string; text: string }>,
  newFacts: string[],
): string {
  const existingMemoriesText = existingMemories
    .map((m) => `ID: ${m.id} - ${m.text}`)
    .join("\n");

  return `You are a smart memory manager which controls the memory of a system.
You can perform four operations: (1) ADD a new memory, (2) UPDATE an existing memory, (3) DELETE an existing memory, and (4) do NONE (no changes needed).

Existing Memories:
${existingMemoriesText || "(none)"}

New Information:
${newFacts.map((f) => `- ${f}`).join("\n")}

Instructions:
- If the new information contradicts an existing memory, UPDATE the existing memory.
- If the new information is already covered by an existing memory, do NONE.
- If the new information is entirely new, ADD it.
- If an existing memory is no longer relevant based on new info, DELETE it.
- Be concise in your memory updates.

Respond with a JSON object containing a "memory" array. Each item should have:
- "id": the memory ID (for UPDATE/DELETE) or "new" (for ADD)
- "event": "ADD", "UPDATE", "DELETE", or "NONE"
- "old_memory": the old memory text (for UPDATE/DELETE)
- "text": the new/updated memory text

Example:
{"memory": [
  {"id": "0", "event": "UPDATE", "old_memory": "Likes pizza", "text": "Loves pepperoni pizza"},
  {"id": "new", "event": "ADD", "text": "Is planning a trip to Japan"},
  {"id": "1", "event": "DELETE", "old_memory": "Likes sushi", "text": "No longer likes sushi"},
  {"id": "2", "event": "NONE", "old_memory": "Has a dog named Max", "text": "Has a dog named Max"}
]}`;
}

export function removeCodeBlocks(text: string): string {
  // Remove markdown code blocks
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  cleaned = cleaned.trim();
  return cleaned;
}
