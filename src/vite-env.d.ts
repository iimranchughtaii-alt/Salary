/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'virtual:project-files' {
  export interface ProjectFileEntry {
    path: string;
    content: string;
    encoding: 'utf-8' | 'base64';
  }
  const files: ProjectFileEntry[];
  export default files;
}
