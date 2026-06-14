import { useEditor } from "@tiptap/react";

export function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btnClass = (active: boolean) =>
    `px-2 py-1 rounded text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
    }`;

  const handleAddLink = () => {
    const href = window.prompt("Enter URL:");
    if (href) {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  };

  const handleAddImage = () => {
    const src = window.prompt("Enter image URL:");
    if (src) {
      const alt = window.prompt("Enter alt text:") ?? "";
      editor.chain().focus().setImage({ src, alt }).run();
    }
  };

  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-border bg-muted/20 rounded-t-lg">
      {/* Headings */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btnClass(editor.isActive("heading", { level: 2 }))}
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btnClass(editor.isActive("heading", { level: 3 }))}
      >
        H3
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        className={btnClass(editor.isActive("heading", { level: 4 }))}
      >
        H4
      </button>

      <div className="w-px h-6 bg-border mx-1 self-center" />

      {/* Formatting */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btnClass(editor.isActive("bold"))}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btnClass(editor.isActive("italic"))}
      >
        <em>I</em>
      </button>

      <div className="w-px h-6 bg-border mx-1 self-center" />

      {/* Lists */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btnClass(editor.isActive("bulletList"))}
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btnClass(editor.isActive("orderedList"))}
      >
        1. List
      </button>

      <div className="w-px h-6 bg-border mx-1 self-center" />

      {/* Link & Image */}
      <button
        type="button"
        onClick={handleAddLink}
        className={btnClass(editor.isActive("link"))}
      >
        Link
      </button>
      <button
        type="button"
        onClick={handleAddImage}
        className={btnClass(false)}
      >
        Image
      </button>
    </div>
  );
}
