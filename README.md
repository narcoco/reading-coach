# Reading Coach for Zotero

Reads a paper with you in six steps, using your own AI model, and saves the result to Obsidian. Every step is optional: click any tab to jump to it, and save from **Takeaway and save** whenever you like. The note includes only what you filled in.

1. **Guess**: from the title only. The abstract stays hidden until you guess. You can ask for 1 to 3 questions to guide your guess; they come from the abstract but never give its findings away.
2. **Abstract**: mark how close your guess was, then skip the paper, keep it for later (tags `rc-skipped` or `rc-later`), or study it now.
3. **Questions**: choose what to focus on (Findings, Methods, Theory, Limitations) and the model asks one question for each. You answer them all before it checks your answers against the paper. Each check shows the section, an exact quote, and a **Go to page** button that turns the PDF to the right page (or **Copy the quote** to find it with Cmd+F).
4. **Figure and limit**: one line on the key figure, one on what the study can't tell you.
5. **Discuss** (optional): a sceptical colleague asks you one question at a time.
6. **Takeaway and save**: a **Paper at a glance** (research question, theory, methods, findings, limitations), pre-filled from your answers and the paper for you to rewrite; then your own takeaway, your stance against your position, the kind of evidence, and a link to a paper you've already read.

The Obsidian note opens with the at-a-glance section. Clips you assign to a section (Theory, Methods and so on) appear under that heading; unsorted clips go under "What the paper actually says".

When you choose **Study it with the PDF**, the paper opens in Zotero's reader and the remaining steps continue in the **Reading Coach** section of the reader's right-hand panel.

**My clips:** after the abstract, keep what the paper actually says. Click an abstract sentence, drag text or highlights in from the PDF, or paste a passage. Each clip can carry a short note, and all of them go into the Obsidian note.

Saving writes a note to your vault (with properties, clips and flashcards), adds a short note under the paper in Zotero, and rebuilds the reading table. If you close the window partway, it picks up where you left off.

## Install

Download the newest `.xpi` from the [`dist` folder](https://github.com/narcoco/reading-coach/tree/main/dist) (open the file, then **Download raw file**). Once installed, Zotero updates it automatically.

1. In Zotero, open **Tools → Plugins**.
2. Click the gear icon, choose **Install Plugin From File…**, and pick `reading-coach.xpi`.
3. Restart Zotero if it asks.

## Set up (Zotero Settings → Reading Coach)

- **Model**: any OpenAI-compatible chat service. Enter its address, model name and your API key, then click **Test the connection**.
  - DeepSeek address: `https://api.deepseek.com`. Check DeepSeek's documentation for the current model name.
  - Qwen, Kimi and OpenRouter also work. Use the OpenAI-compatible address from each provider's documentation.
  - For a local model in Ollama, use `http://localhost:11434/v1` and leave the key empty.
- **Obsidian**: choose your vault folder. Notes are named by citekey (from Better BibTeX or Zotero's Citation Key field) using the **Note name** pattern, for example `{{citekey}}` or `@{{citekey}}`. Papers without a citekey are named "Author Year - Title". Notes go in `Papers`, trend checks in `Trends`, and the table in `Reading table.md`. You can rename all three.
- **Your research**: your field, and one or two lines on your current position. Every paper is compared with it.

## Use

- **Read a paper**: right-click it in your library and choose **Read with Reading Coach**.
- **Trend check**: choose **Tools → Reading Coach: trend check**. Write your own reading first, then compare it with your notes. Needs at least 3 finished papers.
- **Rebuild the table**: choose **Tools → Reading Coach: rebuild reading table**, if you've edited notes in Obsidian.

## In Obsidian

- **Reading table**: plain Markdown, so it works without plugins. Papers by year, your takeaway, evidence and stance.
- **Flashcards**: each note ends with `Question::Answer` lines under `#flashcards`. The community **Spaced Repetition** plugin turns them into review cards.
- **Dataview**: the properties (`year`, `stance`, `evidence`, `takeaway`, `limit`) also work with Dataview, if you want your own views.

## Good to know

- **Paper text**: when a paper has a PDF, the AI reads its text (up to 100,000 characters, which covers most papers in full; change this in settings). If Zotero hasn't extracted the text yet, Reading Coach asks it to. If there's no PDF, or the PDF is a scanned image with no text, the AI reads the abstract only. The screen always says which.
- **Privacy**: the paper's text and your answers are sent to the model service you chose. Your API key is stored in Zotero's settings on this computer.
- **Cost**: one paper costs a few model calls, plus one for each discussion turn. Each call resends the paper text, up to 100,000 characters.
- **Version**: this is a first version (0.3.1). It is marked compatible with Zotero 7 to 11. Zotero now releases a new major version every 6 to 10 weeks, and each one may need the plugin's version limit raised.

## Releasing an update

1. Raise `version` in `manifest.json` (for example 0.2.1 to 0.2.2). For a new Zotero version, also raise `strict_max_version` here and in `updates.json`.
2. Build the `.xpi`: zip `manifest.json`, `bootstrap.js`, `prefs.js`, `content` and `locale`, with these at the top level of the zip. Save it as `dist/reading-coach-0.2.2.xpi`.
3. In `updates.json`, set `version` to the new number and point `update_link` at the new file.
4. Commit and push. Zotero checks `updates.json` about once a day, or straight away from Tools → Plugins → gear → Check for Updates.

## Ideas for later

- **Connections to your vault**: in the discussion step, give the AI your recent notes (takeaways, stances, clips) so it can ask how this paper connects to papers you've already read, and suggest links.
