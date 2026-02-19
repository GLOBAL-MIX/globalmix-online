const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const https = require('https');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

const TARGET_WEBSITE = 'globalmix.online';

async function syncPages() {
  console.log(`🔄 Starting Sync for: ${TARGET_WEBSITE}...`);

  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        { property: 'Sync to GitHub', checkbox: { equals: true } },
        { property: 'Status', status: { equals: 'Published' } },
        { property: 'Website', select: { equals: TARGET_WEBSITE } }
      ]
    }
  });

  if (response.results.length === 0) {
      console.log("⚠️ No articles matched the exact filters (Published + globalmix.online + Sync Checked).");
      return;
  }

  for (const page of response.results) {
    const props = page.properties;
    
    // SAFE ARRAY ACCESS
    const title = props['Page Title']?.title?.[0]?.plain_text || 'untitled';
    const slug = props['URL Slug']?.rich_text?.[0]?.plain_text || slugify(title);

    const imageDir = path.join('images', 'posts', slug);
    if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
    }

    let coverImage = '';
    if (props['Cover Image'] && props['Cover Image'].files && props['Cover Image'].files.length > 0) {
        const fileObj = props['Cover Image'].files[0];
        const imageUrl = fileObj.file?.url || fileObj.external?.url;
        if (imageUrl) {
            const ext = getExtension(imageUrl);
            const filename = 'cover' + ext;
            await downloadImage(imageUrl, path.join(imageDir, filename));
            coverImage = '/images/posts/' + slug + '/' + filename;
        }
    }

    const blocks = await notion.blocks.children.list({
      block_id: page.id,
      page_size: 100
    });

    const markdown = await convertBlocksToMarkdown(blocks.results, slug, imageDir);
    const frontmatter = generateFrontmatter(props, coverImage);

    // --- JEKYLL DATE FIX ---
    // Grabs the publish date from Notion, or uses today's date as a fallback
    const dateStr = props['Publish Date']?.date?.start?.split('T')[0] || new Date().toISOString().split('T')[0];
    
    // Saves as: YYYY-MM-DD-slug.md
    const filepath = path.join('_posts', dateStr + '-' + slug + '.md');

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, frontmatter + '\n\n' + markdown);

    console.log(`✓ Synced "${title}" to GitHub with Jekyll-friendly filename`);

    // UPDATE NOTION STATUS & DATE
    try {
        const now = new Date().toISOString(); 
        await notion.pages.update({
            page_id: page.id,
            properties: {
                'Status': {
                    status: { name: 'Live' }
                },
                'Last Synced to GitHub': {
                    date: { start: now }
                }
            }
        });
        console.log(`✓ SUCCESS: Updated Notion status to "Live" for "${title}"`);
    } catch (error) {
        console.error(`❌ FAILED to update Notion for "${title}". Reason:`, error.body || error.message);
    }
  }
}

function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
            fs.unlink(filepath, () => {}); 
            reject(err.message);
        });
    });
}

function getExtension(url) {
    const cleanUrl = url.split('?')[0];
    const ext = path.extname(cleanUrl);
    return ext || '.jpg';
}

function generateFrontmatter(props, coverImage) {
  const meta = {
    layout: 'post',
    title: props['Page Title']?.title?.[0]?.plain_text || '',
    description: props['Meta Description']?.rich_text?.[0]?.plain_text || '',
    date: props['Publish Date']?.date?.start || '',
    tags: props['Tags']?.multi_select?.map(t => t.name) || [],
    image: coverImage,
    author: props['Author']?.rich_text?.[0]?.plain_text || '',
    excerpt: props['Excerpt']?.rich_text?.[0]?.plain_text || ''
  };

  return '---\n' + Object.entries(meta)
    .filter(([k, v]) => v)
    .map(([k, v]) => k + ': ' + JSON.stringify(v))
    .join('\n') + '\n---';
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function convertBlocksToMarkdown(blocks, slug, imageDir) {
  const output = [];
  for (const block of blocks) {
    switch(block.type) {
      case 'paragraph': output.push(block.paragraph.rich_text.map(t => t.plain_text).join('')); break;
      case 'heading_1': output.push('# ' + block.heading_1.rich_text.map(t => t.plain_text).join('')); break;
      case 'heading_2': output.push('## ' + block.heading_2.rich_text.map(t => t.plain_text).join('')); break;
      case 'heading_3': output.push('### ' + block.heading_3.rich_text.map(t => t.plain_text).join('')); break;
      case 'bulleted_list_item': output.push('- ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('')); break;
      case 'numbered_list_item': output.push('1. ' + block.numbered_list_item.rich_text.map(t => t.plain_text).join('')); break;
      case 'image':
        const imgObj = block.image;
        const imgUrl = imgObj.file?.url || imgObj.external?.url;
        if (imgUrl) {
            const ext = getExtension(imgUrl);
            const filename = block.id + ext;
            const savePath = path.join(imageDir, filename);
            const publicPath = '/images/posts/' + slug + '/' + filename;
            try {
                await downloadImage(imgUrl, savePath);
                output.push('![Image](' + publicPath + ')');
            } catch (e) { console.error(`Failed to download image: ${e}`); }
        }
        break;
    }
  }
  return output.join('\n\n');
}

syncPages().catch(console.error);
