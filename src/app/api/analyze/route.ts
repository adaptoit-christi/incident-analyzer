import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const SYSTEM_PROMPT = `You are a security incident analyst.
Return ONLY valid JSON matching this type:
{
  "csf": { "Identify": string[], "Protect": string[], "Detect": string[], "Respond": string[], "Recover": string[] },
  "timeline": { "time"?: string, "event": string }[],
  "severity": "Low" | "Medium" | "High" | "Critical",
  "root_cause": string,
  "impacted_assets": string[],
  "mitre"?: string[],
  "nist_800_53"?: string[],
  "customer_safe_summary": string,
  "actions": { "title": string, "owner"?: string, "priority"?: "P1"|"P2"|"P3", "due_window"?: string }[]
}
Guidelines:
- Build a concise timeline (use timestamps if present).
- State likely root cause and severity with a one-sentence justification.
- Map to NIST CSF with 3–6 concise bullets per function, and include relevant NIST 800-53 control IDs (e.g., AC-2, IA-2, AU-6, IR-4, CP-2).
- Include 5–10 concrete follow-up actions.
- Audience for customer_safe_summary is non-technical.
- Output JSON only, no prose.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticket, attachments } = body;

    if (!ticket || typeof ticket !== 'string') {
      return NextResponse.json({ error: 'Invalid ticket description' }, { status: 400 });
    }

    if (ticket.length > 10000) {
      return NextResponse.json({ error: 'Ticket description too long' }, { status: 400 });
    }

    let userPrompt = `TICKET:\n${ticket}\n\n`;

    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        const truncatedText = att.text.substring(0, 6000);
        userPrompt += `ATTACHMENT: ${att.name} (${att.mime})\n${truncatedText}\n\n`;
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not configured');
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    let content = resp.choices[0]?.message?.content || '';
    
    content = content.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch (parseError) {
      console.log('Initial parse failed, attempting fix...');
      const fixResp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'Fix malformed JSON. Output ONLY valid JSON.' },
          { role: 'user', content: `Fix this JSON:\n${content}` },
        ],
      });

      let fixedContent = fixResp.choices[0]?.message?.content || '';
      fixedContent = fixedContent.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
      analysis = JSON.parse(fixedContent);
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}