/* React Native's codegen parser recognises these exact deep import paths, but
   0.87 no longer ships types for them. Map them onto the public type surface so
   the specs typecheck and codegen still reads them. */

declare module 'react-native/Libraries/Types/CodegenTypes' {
  import type {CodegenTypes} from 'react-native';

  export type BubblingEventHandler<T, S extends string | never = never> =
    CodegenTypes.BubblingEventHandler<T, S>;
  export type DirectEventHandler<T, S extends string | never = never> =
    CodegenTypes.DirectEventHandler<T, S>;
  export type Double = CodegenTypes.Double;
  export type Float = CodegenTypes.Float;
  export type Int32 = CodegenTypes.Int32;
  export type UnsafeObject = CodegenTypes.UnsafeObject;
  export type UnsafeMixed = CodegenTypes.UnsafeMixed;
  export type WithDefault<
    T extends number | boolean | string | ReadonlyArray<string>,
    V extends (null | undefined | T) | string,
  > = CodegenTypes.WithDefault<T, V>;
}

declare module 'react-native/Libraries/Utilities/codegenNativeComponent' {
  const codegenNativeComponent: typeof import('react-native').codegenNativeComponent;
  export default codegenNativeComponent;
}

declare module 'react-native/Libraries/Utilities/codegenNativeCommands' {
  const codegenNativeCommands: typeof import('react-native').codegenNativeCommands;
  export default codegenNativeCommands;
}
