export const USER_COLUMNS = `user_id,
team_id,
role_id,
username,
first_name,
last_name,
email,
phone,
password_hash,
is_active,
last_login,
created_at,
updated_at,
created_by,
deleted_at,
deleted_by`

export const USER_FIELDS = [
    'team_id',
    'role_id',
    'username',
    'first_name',
    'last_name',
    'phone',
    'email',
    'password_hash',
    'is_active',
    'last_login',
    'created_by',
] as const;

// export type UserField = (typeof USER_FIELDS)[number];

export type PermissionWrite = Partial<{
    team_id : string,
    role_id : string,
    username : string,
    first_name : string,
    last_name : string| null,
    email : string ,
    phone : string,
}>

type ValidationResult =
  | { ok: true; data: PermissionWrite }
  | { ok: false; errors: string[] };



export function ValidatorUserPayload(
    body : unknown,
    options : {isPartial : boolean}
){

}