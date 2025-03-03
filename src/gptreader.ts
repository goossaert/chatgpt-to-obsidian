import * as fs from "fs";
import * as path from "path";
import * as moment from 'moment';
import * as yaml from 'js-yaml';
import matter from 'gray-matter';

// Define a type for our URL-to-filepath dictionary.
interface URLMap {
  [url: string]: string;
}


// Get the filename from command-line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Error: Please provide the path to the conversations JSON file.");
  console.log("Usage: npm start <path-to-file>");
  process.exit(1);
}

const filePath = path.resolve(args[0]);


const PREFIX = process.argv.slice(3);
const FOLDER_CONVERSATIONS = `${PREFIX}/output/conv`;
const FOLDER_YOUTUBE_TRANSCRIPTS = `${PREFIX}/output/yt-transcript`;
const FOLDER_YOUTUBE_SUMMARIES = `${PREFIX}/output/yt-summaries`;





const urlToFileMap1 = exploreDirectoryIteratively(FOLDER_CONVERSATIONS);
//console.log(JSON.stringify(urlToFileMap1, null, 4));


const urlToFileMap2 = exploreDirectoryIteratively(FOLDER_YOUTUBE_SUMMARIES);
//console.log(JSON.stringify(urlToFileMap2, null, 4));


const urlToFileMap = { ...urlToFileMap1, ...urlToFileMap2 };
//console.log(JSON.stringify(urlToFileMap, null, 4));






function removeUtmSource(url: string): string {
  const utmString = "?utm_source=chatgpt.com";
  
  if (url.endsWith(utmString)) {
      return url.slice(0, -utmString.length);
  }

  return url;
}




/**
 * Extracts the URL from the YAML frontmatter of a Markdown file.
 *
 * @param filePath - The full path to the Markdown file.
 * @returns The URL found in the YAML frontmatter, or null if not found.
 */
function extractURLFromMarkdown(filePath: string): string | null {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(fileContent);
  if (parsed.data && parsed.data.URL) {
    return parsed.data.URL;
  }
  return null;
}

/**
 * Explores a directory iteratively and for each Markdown (.md) file found,
 * extracts the URL from its YAML frontmatter and populates a dictionary
 * with the URL as key and the file path as value.
 *
 * The traversal is performed using an explicit stack, avoiding recursion.
 *
 * @param directory - The root directory to start the search.
 * @returns A dictionary mapping URLs to file paths.
 */
function exploreDirectoryIteratively(directory: string): URLMap {
  // The dictionary is local to this method.
  const urlMap: URLMap = {};
  
  // Use a stack to hold directories to process.
  const stack: string[] = [directory];

  while (stack.length > 0) {
    const currentDir = stack.pop() as string; // Guaranteed non-null because of the while condition.
    const entries = fs.readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        // Add the subdirectory to the stack for later processing.
        stack.push(fullPath);
      } else if (stats.isFile() && path.extname(entry) === '.md') {
        // Process Markdown files.
        const url = extractURLFromMarkdown(fullPath);
        if (url) {
          urlMap[url] = fullPath;
        }
      }
    }
  }

  return urlMap;
}





function getConversationMessages(conversation: any) {
  var messages = [];
  var sources :any = [];
  var model_slug = undefined;
  var currentNode = conversation.current_node;
  while (currentNode != null) {
      var node = conversation.mapping[currentNode];
      if (
          node.message &&
          node.message.content &&
          node.message.content.parts &&
          node.message.content.parts.length > 0 &&
          (node.message.author.role !== "system"  || node.message.metadata.is_user_system_message)
      ) {
          var author = node.message.author.role;
          if (author === "assistant" || author === "tool") {
              author = "ChatGPT";
          } else if (author === "system" && node.message.metadata.is_user_system_message) {
              author = "Custom user info";
          }
          if (node.message.content.content_type == "text" || node.message.content.content_type == "multimodal_text") {
            var parts = [];
            for (var i = 0; i < node.message.content.parts.length; i++) {
              var part = node.message.content.parts[i];
              if (typeof part === "string" && part.length > 0) {
                parts.push({text: part});
              } else if (part.content_type == "audio_transcription") {
                parts.push({transcript: part.text});
              } else if (part.content_type == "audio_asset_pointer" || part.content_type == "image_asset_pointer" || part.content_type == "video_container_asset_pointer") {
                parts.push({asset: part});
              } else if (part.content_type == "real_time_user_audio_video_asset_pointer") {
                if (part.audio_asset_pointer) {
                  parts.push({asset: part.audio_asset_pointer});
                }
                if (part.video_container_asset_pointer) {
                  parts.push({asset: part.video_container_asset_pointer});
                }
                for (var j = 0; j < part.frames_asset_pointers.length; j++) {
                  parts.push({asset: part.frames_asset_pointers[j]});
                }
              }
            }
            if (parts.length > 0) {
              messages.push({ author: author, parts: parts });
            }
          }
      }


      // Check for sources_footnote entries
      if (node.message && node.message.metadata && Array.isArray(node.message.metadata.content_references)) {
        node.message.metadata.content_references.forEach((reference: any) => {
          if (reference.type === "sources_footnote" && reference.sources) {
            sources.push(reference.sources);
            //console.log(JSON.stringify(sources, null, 4));
          }
        });
      }

      if (node.message && node.message.metadata && node.message.metadata.model_slug) {
        model_slug = node.message.metadata.model_slug;
        //console.log(`model_slug ${model_slug}`);
      }

      currentNode = node.parent;

      
  }
  return [messages.reverse(), sources, model_slug];
}





// Function to read and parse the JSON file
function readConversations(file: string) {
  try {
    if (!fs.existsSync(file)) {
      console.error(`❌ Error: File not found at ${file}`);
      process.exit(1);
    }

    const rawData = fs.readFileSync(file, "utf8");
    const conversations = JSON.parse(rawData);

    //console.log("📌 ChatGPT Conversations:");
    /*
    conversations.forEach((conversation: any, index: number) => {
      console.log(`\n🔹 Conversation ${index + 1}:`);
      console.log(`   Title: ${conversation.title}`);
      console.log(`   Created At: ${new Date(conversation.create_time * 1000).toLocaleString()}`);
      console.log(`   Updated At: ${new Date(conversation.update_time * 1000).toLocaleString()}`);
      
      // Extract messages
      if (conversation.mapping) {
        Object.values(conversation.mapping).forEach((msg: any) => {
          if (msg.message && msg.message.content && Array.isArray(msg.message.content.parts)) {
            const content = msg.message.content.parts.join(" ").trim();
            if (content.length > 0) {
              console.log(`   🗣️ ${msg.message.author.role}: ${content}`);
            }
          }
        });
      }
    });
    */


   if (!fs.existsSync(FOLDER_CONVERSATIONS)){
    fs.mkdirSync(FOLDER_CONVERSATIONS, { recursive: true });
  }

  if (!fs.existsSync(FOLDER_YOUTUBE_SUMMARIES)){
    fs.mkdirSync(FOLDER_YOUTUBE_SUMMARIES, { recursive: true });
  }

  if (!fs.existsSync(FOLDER_YOUTUBE_TRANSCRIPTS)){
    fs.mkdirSync(FOLDER_YOUTUBE_TRANSCRIPTS, { recursive: true });
  }

   //conversations.forEach((conversation: any, index: number) => {
  for (let index = 0; index < conversations.length; index++) {
      let conversation = conversations[index];

      var category = undefined;
      if (conversation.title) {
        var indexCategory = conversation.title.indexOf(" - ");
        if (indexCategory > 0) {
            category = conversation.title.substring(0, indexCategory).replaceAll(/ /g, '-').toLowerCase();
            conversation.title = conversation.title.substring(indexCategory + 3);
        }
      } else {
        conversation.title = `no-title-${moment.unix(conversation.create_time).format("YYYY-MM-DD-HH-mm")}`
      }


      var [messages, sources, model_slug] = getConversationMessages(conversation);

      //console.log(`\n🔹 Conversation ${index + 1}:`);
      if (!messages[0].parts || !messages[0].parts[0] || !messages[0].parts[0].text) continue;

      var messageStartIndex = 0;
      var transcriptTitle = 'Title: "';
      var transcriptStart = 'Transcript: "';
      let indexTitle = messages[0].parts[0].text.indexOf(transcriptTitle);
      let indexTranscript = messages[0].parts[0].text.indexOf(transcriptStart);
      let isYoutubeTranscript = indexTitle != -1 && indexTranscript != -1 ? true : false;
      let videoTitle = undefined;
      if (isYoutubeTranscript) {
        videoTitle = messages[0].parts[0].text.substring(indexTitle + transcriptTitle.length, indexTranscript - 2).replaceAll(/[#\[\]\|\^]/g, '-').replaceAll(/[\/:]/g, '-');
      }


      if (category === undefined && isYoutubeTranscript === false) continue;

      let outputConversation = [];
      let outputTranscript = [];

      if (category === undefined) {
        category = 'none';
      }

      conversation.title = conversation.title.replaceAll(/[\/:]/g, '-');
      let uniqueId = conversation.id.substr(conversation.id.length - 6);
      let url = `https://chatgpt.com/c/${conversation.id}`;

      if (isYoutubeTranscript) {
        outputTranscript.push(`---`);
        //outputTranscript.push(`title: ${conversation.title}`);
        outputTranscript.push(`title: "${videoTitle}"`);
        outputTranscript.push(`tags:`);
        outputTranscript.push(`   - ${category}`);
        outputTranscript.push(`URL: `);
        outputTranscript.push(`type: youtube-transcript`);
        outputTranscript.push(`---`);
        outputTranscript.push(``);

        outputTranscript.push( 
          messages[0].parts[0].text.substring(indexTranscript + transcriptStart.length, messages[0].parts[0].text.length-2)
        );


        outputConversation.push(`---`);
        outputConversation.push(`title: ${conversation.title}`);
        outputConversation.push(`tags:`);
        outputConversation.push(`   - ${category}`);
        outputConversation.push(`URL: ${url}`);
        outputConversation.push(`transcript: "[[${videoTitle}]]"`);
        outputConversation.push(`type: chatgpt-youtube-summary`);
        outputConversation.push(`model_slug: ${model_slug}`);
        outputConversation.push(`created_at: ${moment.unix(conversation.create_time).format("YYYY-MM-DD HH:mm")}`);
        outputConversation.push(`updated_at: ${moment.unix(conversation.update_time).format("YYYY-MM-DD HH:mm")}`);
        outputConversation.push(`status: imported`);
        outputConversation.push(`---`);
        outputConversation.push(``);


        // start message at index 1
        messageStartIndex = 1;
      } else {
        outputConversation.push(`---`);
        outputConversation.push(`title: ${conversation.title}`);
        outputConversation.push(`tags:`);
        if (category) {
          outputConversation.push(`   - ${category}`);
        } else {
          outputConversation.push(`   - none`);
        }
        outputConversation.push(`URL: ${url}`);
        outputConversation.push(`type: chatgpt-conversation`);
        outputConversation.push(`model_slug: ${model_slug}`);
        outputConversation.push(`created_at: ${moment.unix(conversation.create_time).format("YYYY-MM-DD HH:mm")}`);
        outputConversation.push(`updated_at: ${moment.unix(conversation.update_time).format("YYYY-MM-DD HH:mm")}`);
        outputConversation.push(`status: imported`);
        outputConversation.push(`---`);
        outputConversation.push(``);
      }



      for (var j = messageStartIndex; j < messages.length; j++) {
        //message.className = "message";
        outputConversation.push(`> [!NOTE] Author`);
        outputConversation.push(`>`);
        outputConversation.push(`> # Author: ${messages[j].author}`);
        outputConversation.push(``);
        if (messages[j].parts) {
          for (var k = 0; k < messages[j].parts.length; k++) {
            var part = messages[j].parts[k];
            if (part.text) {
              var cleanedText = part.text.replaceAll(/[\uE000-\uF8FF]/g, "");
              //outputConversation.push(`${cleanedText}`);
              //var indexTranscript = cleanedText.indexOf(transcriptStart);
              //if (cleanedText.indexOf('Use the text above') != -1 || indexTranscript != -1) {
              //if (indexTranscript != -1) {
              //  isYoutubeTranscript = true;
              //  cleanedText = cleanedText.substring(indexTranscript + transcriptStart.length, cleanedText.length-2);
              //}
              outputConversation.push(`${cleanedText}`);
            } /*else if (assetsJson) {
              if (part.transcript) {
                message.innerHTML += `<div>[Transcript]: ${part.transcript}</div>`;
              } else if (part.asset) {
                var link = assetsJson[part.asset.asset_pointer];
                if (link) {
                  message.innerHTML += `<div>[File]: <a href="${link}">${link}</a></div>`;
                } else {
                  message.innerHTML += `<div>[File]: -Deleted-</div>`;
                }
              }
            }*/
          }
        }

        if (j != messages.length - 1) {
          outputConversation.push(``);
          outputConversation.push(``);
        };
    }
    if (sources && sources.length > 0) {
      //outputConversation.push("sources:", sources);

      let sourcesFormatted:any = {};
      for (let i = 0; i < sources.length; i++) {
        for (let j = 0; j < sources.length; j++) {
          //console.log(`Processing source: ${sources[i][j]}`);
          if (sources[i][j] === undefined) continue;
          sourcesFormatted[removeUtmSource(sources[i][j].url)] = sources[i][j].title;
        }
      }

      if (Object.keys(sourcesFormatted).length) {
        outputConversation.push(``);
        outputConversation.push(``);
        outputConversation.push(`> [!info]`);
        outputConversation.push(`>`);
        outputConversation.push(`> # Sources`);
        outputConversation.push(``);
        
        Object.entries(sourcesFormatted).forEach(([key, value]) => {
          outputConversation.push(`- [${value}](${key})`);
        });
      }
    }

    /*
    console.log(outputTranscript.join('\n'));
    console.log('');
    console.log('');
    console.log('');
    console.log('');
    console.log('');
    console.log('');
    console.log(outputConversation.join('\n'));
*/


    // ============================
    // SAVE TO DISK
    // ============================

    /**
     * Helper function to extract YAML frontmatter from a markdown string.
     * Expects the frontmatter to be between the first two occurrences of "---".
     */
    function parseYamlHeader(content: string): any {
      const lines = content.split('\n');
      if (lines[0].trim() !== '---') {
        return null;
      }
      const headerLines = [];
      // Start at line 1 and collect lines until a line with only '---'
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
          break;
        }
        headerLines.push(lines[i]);
      }
      const headerText = headerLines.join('\n');
      try {
        return yaml.load(headerText);
      } catch (e) {
        console.error("YAML parsing error:", e);
        return null;
      }
    }

    /**
     * Saves the file at filePath after comparing the in-memory YAML header (from newContent)
     * with the one on disk. Depending on the following scenarios, it will either write the new file,
     * do nothing, or log a conflict message:
     *
     * - File does not exist: write newContent.
     * - If existing file's `type` property differs: conflict.
     * - If `updated_at` is unchanged and:
     *      * disk version has no `modified_at`: do nothing.
     *      * disk version has a `modified_at`: do nothing.
     * - If `updated_at` differs and:
     *      * disk version has no `modified_at`: overwrite with newContent.
     *      * disk version has a `modified_at`: conflict.
     */
    function saveFileWithVersionCheck(URL: string, filePath: string, newContent: string) {

      if (URL in urlToFileMap && urlToFileMap[URL] != filePath) {
        fs.rename(urlToFileMap[URL], filePath, function (err) {
          if (err) throw err
          console.log(`Successfully moved! - ${filePath}`);
        })
      }

      if (!fs.existsSync(filePath)) {
        // File does not exist: write new content.
        fs.writeFileSync(filePath, newContent);
        console.log(`Saved new file: ${filePath}`);
        return;
      }

      // File exists: read and parse its YAML header.
      const diskContent = fs.readFileSync(filePath, 'utf8');
      const diskHeader = parseYamlHeader(diskContent);
      const newHeader = parseYamlHeader(newContent);

      if (!diskHeader) {
        console.error(`❌ Could not parse YAML header from disk file: ${filePath}. Manual verification needed.`);
        return;
      }
      if (!newHeader) {
        console.error(`❌ Could not parse YAML header from new content for file: ${filePath}. Manual verification needed.`);
        return;
      }

      // Scenario 2: Check if 'type' properties differ.
      if (diskHeader.type !== newHeader.type) {
        console.error(`❌ Conflict for file ${filePath}: type mismatch (disk: "${diskHeader.type}" vs online: "${newHeader.type}"). Manual verification needed.`);
        return;
      }

      // Compare the 'updated_at' values.
      if (diskHeader.updated_at === newHeader.updated_at) {
        // (a) If disk has no 'modified_at', then nothing has changed.
        if (!diskHeader.modified_at) {
          console.log(`No changes for file ${filePath} (updated_at unchanged and no modified_at). Not saving.`);
          return;
        } else {
          // (b) Online version unchanged but disk has been modified.
          console.log(`No changes for file ${filePath} (updated_at unchanged but disk has modified_at). Not saving.`);
          return;
        }
      } else {
        // The updated_at values differ.
        if (!diskHeader.modified_at) {
          // Online version is newer – save (overwrite) the file.
          fs.writeFileSync(filePath, newContent);
          console.log(`Updated file ${filePath} as online version is newer. -- ${diskHeader.updated_at} === ${newHeader.updated_at}`);
          //console.log(JSON.stringify(diskHeader, null, 4));
          //console.log(`---`);
          //console.log(JSON.stringify(newHeader, null, 4));
          return;
        } else {
          // Conflict: the disk file has been modified.
          console.error(`❌ Conflict for file ${filePath}: updated_at mismatch and disk has modified_at. Manual verification needed.`);
          return;
        }
      }
    }

    // Prepare file paths and ensure folders exist, then save.
    if (isYoutubeTranscript) {
      // Save the transcript file if it does not exist (no version checking for transcript files).
      const transcriptFilePath = `${FOLDER_YOUTUBE_TRANSCRIPTS}/${videoTitle}.md`;
      if (!fs.existsSync(transcriptFilePath)) {
        fs.writeFileSync(transcriptFilePath, outputTranscript.join('\n'));
        console.log(`Saved transcript file: ${transcriptFilePath}`);
      }

      // For the conversation summary file, use version checking.
      const summaryFolder = `${FOLDER_YOUTUBE_SUMMARIES}/${category}`;
      if (!fs.existsSync(summaryFolder)) {
        fs.mkdirSync(summaryFolder, { recursive: true });
      }
      const conversationFilePath = `${summaryFolder}/${conversation.title} - ${uniqueId}.md`;
      saveFileWithVersionCheck(url, conversationFilePath, outputConversation.join('\n'));
    } else {
      const folder = `${FOLDER_CONVERSATIONS}/${category}`;
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }
      const conversationFilePath = `${folder}/${conversation.title} - ${uniqueId}.md`;
      saveFileWithVersionCheck(url, conversationFilePath, outputConversation.join('\n'));
    }

  }
  //});

  } catch (error) {
    console.error("❌ Error reading the file:", error);
  }
}

// Run the function with the provided file path
readConversations(filePath);

/*

scenarios
- conversation DOES NOT exist on disk: store the file on disk
- conversation exists on disk but the `type` property is different => conflict, don't store and show a message for manual verification
- conversation exists on disk and (1) the updated_at properties match and        (2) the disk version DOES NOT have a modified_at property => there was no change on either side, therefore don't store
- conversation exists on disk and (1) the updated_at properties match and        (2) the disk version has a modified_at property => the online wasn't modified but the disk was, therefore don't store
- conversation exists on disk and (1) the updated_at properties DO NOT match and (2) the disk version DOES NOT have a modified_at property => the online version is newer, store the new version on disk
- conversation exists on disk and (1) the updated_at properties DO NOT match and (2) the disk version hsa a modified_at property => the two versions are out of sync => conflict, don't store and show a message for manual verification





- if file does not exists yet, jsut write it
- if file exists
    - use gray matter to separate header from content in both the file and the in-memory version
    - if the file has a modified_at field, 



*/
