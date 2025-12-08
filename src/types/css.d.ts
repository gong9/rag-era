// CSS 模块类型声明
declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

// Excalidraw CSS 类型声明
declare module '@excalidraw/excalidraw/index.css';

