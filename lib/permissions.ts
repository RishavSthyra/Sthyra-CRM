import { isObject } from "@/utils/isObject";

const Permission_Fields = [
    "permission_key",
    "permission_name",
    "feature_key",
    "description"
] as const;

export type PermissionWrite =  Partial<{
    permission_key : string,
    permission_name : string,
    feature_key : string,
    description : string
}>

type ValidationResult =
  | { ok: true; data: PermissionWrite }
  | { ok: false; errors: string[] };


export function ValidatePermissionPayload(
    body : unknown,
    options : {isPartial : boolean}
) {
    const errors = [];

    const is_Object = isObject(body);

    if (!is_Object) {
        return {ok : false,errors : ["The object should have valid JSON"]}
    }
    const allowedFields = new Set<string>(Permission_Fields)

    const unknownFields = Object.keys(body).filter((field)=> !allowedFields.has(field))






}