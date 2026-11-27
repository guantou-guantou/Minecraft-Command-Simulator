// The Advanced FMBE ("EX") prerequisite commands of the Bedrock Wiki page "FMBE - A New Way to Create Display Entities" (beta).
// Original documentation (Japanese): Discussion #5 on GitHub, linked from https://wiki.bedrock.dev/commands/display-entities.
// The next-state argument of every command is "_".

export interface PrereqEntry {
  animation: string;
  controller: string;
  expression: string;
}

export const EX3D_PREREQ: PrereqEntry[] = [
  {
    animation: "animation.player.sleeping",
    controller: "controller.animation.fox.move",
    expression: "v.xpos=v.xpos??0;v.ypos=v.ypos??0;v.zpos=v.zpos??0;v.xrot=v.xrot??0;v.yrot=v.yrot??0;v.zrot=v.zrot??0;v.scale=v.scale??1;v.extend_scale=v.extend_scale??1;v.extend_xrot=v.extend_xrot??-90;v.extend_yrot=v.extend_yrot??0;v.xbasepos=v.xbasepos??0;v.ybasepos=v.ybasepos??0;v.zbasepos=v.zbasepos??0;v.F.r5=-math.sin(v.xrot);v.F.r2=-math.sin(v.yrot);v.F.r3=-math.sin(v.zrot);v.F.r4=math.cos(v.zrot);v.F.r8=math.cos(v.yrot);v.F.r0=-v.F.r5*v.F.r2*v.F.r3+v.F.r8*v.F.r4;v.F.r1=-v.F.r5*v.F.r2*v.F.r4-v.F.r8*v.F.r3;v.F.r6=-v.F.r5*v.F.r8*v.F.r3-v.F.r2*v.F.r4;v.F.r7=-v.F.r5*v.F.r8*v.F.r4+v.F.r2*v.F.r3;v.F.r2=v.F.r2*math.cos(v.xrot);v.F.r3=v.F.r3*math.cos(v.xrot);v.F.r4=v.F.r4*math.cos(v.xrot);v.F.r8=v.F.r8*math.cos(v.xrot);v.F.e0=math.cos(v.extend_yrot);v.F.e4=math.cos(v.extend_xrot);v.F.e5=-math.sin(v.extend_xrot);v.F.e6=math.sin(v.extend_yrot);v.F.e1=v.F.e5*v.F.e6;v.F.e2=-v.F.e4*v.F.e6;v.F.e7=-v.F.e5*v.F.e0;v.F.e8=v.F.e4*v.F.e0;v.F.p0=v.F.r0*v.F.e0+v.F.r2*v.F.e6;v.F.p1=v.F.r0*v.F.e1+v.F.r1*v.F.e4+v.F.r2*v.F.e7;v.F.p2=v.F.r0*v.F.e2+v.F.r1*v.F.e5+v.F.r2*v.F.e8;v.F.p3=v.F.r3*v.F.e0+v.F.r5*v.F.e6;v.F.p4=v.F.r3*v.F.e1+v.F.r4*v.F.e4+v.F.r5*v.F.e7;v.F.p5=v.F.r3*v.F.e2+v.F.r4*v.F.e5+v.F.r5*v.F.e8;v.F.p6=v.F.r6*v.F.e0+v.F.r8*v.F.e6;v.F.p7=v.F.r6*v.F.e1+v.F.r7*v.F.e4+v.F.r8*v.F.e7;v.F.p8=v.F.r6*v.F.e2+v.F.r7*v.F.e5+v.F.r8*v.F.e8;",
  },
  {
    animation: "animation.creeper.swelling",
    controller: "wiki.fmbe.3d_blocks.anim1",
    expression: "v.swelling_scale2=v.extend_scale*(v.swelling_scale1=(v.F.s=math.sqrt(32/7*v.scale)));",
  },
  {
    animation: "animation.ender_dragon.neck_head_movement",
    controller: "wiki.fmbe.3d_blocks.anim2",
    expression: "v.head_position_x=-16/v.F.s*((v.xpos-1)*v.F.p1+(v.ypos-1/128)*v.F.p4+v.zpos*v.F.p7+(v.xbasepos*v.F.e1+(v.ybasepos+10/7)*v.extend_scale*v.F.e4+(v.zbasepos-16/7)*v.F.e7)*v.scale);v.head_position_y=16/v.F.s*(((v.xpos-1)*v.F.p2+(v.ypos-1/128)*v.F.p5+v.zpos*v.F.p8)/v.extend_scale+(v.xbasepos*v.F.e2+(v.ybasepos+10/7)*v.extend_scale*v.F.e5+(v.zbasepos-16/7)*v.F.e8)*v.scale);v.head_position_z=16/v.F.s*((v.xpos-1)*v.F.p0+(v.ypos-1/128)*v.F.p3+v.zpos*v.F.p6+(v.xbasepos*v.F.e0+(v.zbasepos-16/7)*v.F.e6)*v.scale);v.head_rotation_x=v.F.e6?math.atan2(0,-v.F.e6):math.atan2(-v.F.e8,v.F.e5);v.head_rotation_y=math.asin(-v.F.e0);v.head_rotation_z=v.F.e6?math.atan2(-v.F.e2,-v.F.e1):0;",
  },
  {
    animation: "animation.warden.move",
    controller: "wiki.fmbe.3d_blocks.anim3",
    expression: "v.body_x_rot=v.F.p5||v.F.p3?math.atan2(v.F.p5,-v.F.p3):math.atan2(-v.F.p0,-v.F.p2);v.body_z_rot=v.F.p5||v.F.p3?math.atan2(-v.F.p1,v.F.p7):0;",
  },
  {
    animation: "animation.player.attack.rotations",
    controller: "wiki.fmbe.3d_blocks.anim4",
    expression: "v.attack_body_rot_y=math.asin(-v.F.p4);",
  },
];

export const EX2D_PREREQ: PrereqEntry[] = [
  {
    animation: "animation.player.sleeping",
    controller: "controller.animation.fox.move",
    expression: "v.xpos=v.xpos??0;v.ypos=v.ypos??0;v.zpos=v.zpos??0;v.xrot=v.xrot??0;v.yrot=v.yrot??0;v.zrot=v.zrot??0;v.scale=v.scale??1;v.extend_scale=v.extend_scale??1;v.extend_xrot=v.extend_xrot??-90;v.extend_yrot=v.extend_yrot??0;v.xbasepos=v.xbasepos??0;v.ybasepos=v.ybasepos??0;v.zbasepos=v.zbasepos??0;v.F.r5=-math.sin(v.xrot);v.F.r2=-math.sin(v.yrot);v.F.r3=-math.sin(v.zrot);v.F.r4=math.cos(v.zrot);v.F.r8=math.cos(v.yrot);v.F.r0=-v.F.r5*v.F.r2*v.F.r3+v.F.r8*v.F.r4;v.F.r1=-v.F.r5*v.F.r2*v.F.r4-v.F.r8*v.F.r3;v.F.r6=-v.F.r5*v.F.r8*v.F.r3-v.F.r2*v.F.r4;v.F.r7=-v.F.r5*v.F.r8*v.F.r4+v.F.r2*v.F.r3;v.F.r2=v.F.r2*math.cos(v.xrot);v.F.r3=v.F.r3*math.cos(v.xrot);v.F.r4=v.F.r4*math.cos(v.xrot);v.F.r8=v.F.r8*math.cos(v.xrot);v.F.e0=math.cos(v.extend_yrot);v.F.e4=math.cos(v.extend_xrot);v.F.e5=-math.sin(v.extend_xrot);v.F.e6=math.sin(v.extend_yrot);v.F.e1=v.F.e5*v.F.e6;v.F.e2=-v.F.e4*v.F.e6;v.F.e7=-v.F.e5*v.F.e0;v.F.e8=v.F.e4*v.F.e0;v.F.p0=v.F.r0*v.F.e0+v.F.r2*v.F.e6;v.F.p1=v.F.r0*v.F.e1+v.F.r1*v.F.e4+v.F.r2*v.F.e7;v.F.p2=v.F.r0*v.F.e2+v.F.r1*v.F.e5+v.F.r2*v.F.e8;v.F.p3=v.F.r3*v.F.e0+v.F.r5*v.F.e6;v.F.p4=v.F.r3*v.F.e1+v.F.r4*v.F.e4+v.F.r5*v.F.e7;v.F.p5=v.F.r3*v.F.e2+v.F.r4*v.F.e5+v.F.r5*v.F.e8;v.F.p6=v.F.r6*v.F.e0+v.F.r8*v.F.e6;v.F.p7=v.F.r6*v.F.e1+v.F.r7*v.F.e4+v.F.r8*v.F.e7;v.F.p8=v.F.r6*v.F.e2+v.F.r7*v.F.e5+v.F.r8*v.F.e8;",
  },
  {
    animation: "animation.creeper.swelling",
    controller: "wiki.fmbe.2d_blocks.anim1",
    expression: "v.F.co=math.cos(25);v.F.si=math.sin(25);v.swelling_scale2=v.extend_scale*(v.swelling_scale1=(v.F.s=math.sqrt(17/8*v.scale)));",
  },
  {
    animation: "animation.ender_dragon.neck_head_movement",
    controller: "wiki.fmbe.2d_blocks.anim2",
    expression: "v.F.X=(v.xpos-1)*v.F.p0+(v.ypos-1/128)*v.F.p3+v.zpos*v.F.p6+((v.xbasepos+2/9)*v.F.e0+(v.zbasepos+32/65)*v.F.e6*v.extend_scale)*v.scale;v.F.Y=(v.xpos-1)*v.F.p1+(v.ypos-1/128)*v.F.p4+v.zpos*v.F.p7+((v.xbasepos+2/9)*v.F.e1+(v.ybasepos+10/11)*v.F.e4+(v.zbasepos+32/65)*v.F.e7*v.extend_scale)*v.scale;v.head_position_y=16/v.F.s*(((v.xpos-1)*v.F.p2+(v.ypos-1/128)*v.F.p5+v.zpos*v.F.p8)/v.extend_scale+((v.xbasepos+2/9)*v.F.e2+(v.ybasepos+10/11)*v.F.e5+(v.zbasepos+32/65)*v.F.e8*v.extend_scale)*v.scale);v.head_position_x=16/v.F.s*(v.F.X*v.F.co-v.F.Y*v.F.si);v.head_position_z=16/v.F.s*(v.F.X*v.F.si+v.F.Y*v.F.co);v.head_rotation_x=v.F.e6*v.F.si+v.F.e7*v.F.co||v.F.e0*v.F.si*v.F.si+v.F.e1*v.F.si*v.F.co+v.F.e4*v.F.co*v.F.co?math.atan2(-v.F.e6*v.F.si-v.F.e7*v.F.co,v.F.e0*v.F.si*v.F.si+v.F.e1*v.F.si*v.F.co+v.F.e4*v.F.co*v.F.co):math.atan2(v.F.e2*v.F.si+v.F.e5*v.F.co,v.F.e8);v.head_rotation_y=math.asin(v.F.e4*v.F.si*v.F.co-v.F.e1*v.F.co*v.F.co-v.F.e0*v.F.co*v.F.si);v.head_rotation_z=v.F.e6*v.F.si+v.F.e7*v.F.co||v.F.e0*v.F.si*v.F.si+v.F.e1*v.F.si*v.F.co+v.F.e4*v.F.co*v.F.co?math.atan2(v.F.e5*v.F.si-v.F.e2*v.F.co,v.F.e0*v.F.co*v.F.co-v.F.e1*v.F.co*v.F.si+v.F.e4*v.F.si*v.F.si):0;",
  },
  {
    animation: "animation.warden.move",
    controller: "wiki.fmbe.2d_blocks.anim3",
    expression: "v.body_x_rot=v.F.p5||v.F.p3*v.F.si+v.F.p4*v.F.co?math.atan2(v.F.p5,-v.F.p3*v.F.si-v.F.p4*v.F.co):math.atan2(-v.F.p0*v.F.si-v.F.p1*v.F.co,-v.F.p2);v.body_z_rot=v.F.p5||v.F.p3*v.F.si+v.F.p4*v.F.co?math.atan2(v.F.p0*v.F.co-v.F.p1*v.F.si,v.F.p7*v.F.si-v.F.p6*v.F.co):0;",
  },
  {
    animation: "animation.player.attack.rotations",
    controller: "wiki.fmbe.2d_blocks.anim4",
    expression: "v.attack_body_rot_y=math.asin(v.F.p3*v.F.co-v.F.p4*v.F.si);",
  },
];

export const EXITEMS_PREREQ: PrereqEntry[] = [
  {
    animation: "animation.player.sleeping",
    controller: "controller.animation.fox.move",
    expression: "v.xpos=v.xpos??0;v.ypos=v.ypos??0;v.zpos=v.zpos??0;v.xrot=v.xrot??0;v.yrot=v.yrot??0;v.zrot=v.zrot??0;v.scale=v.scale??1;v.extend_scale=v.extend_scale??1;v.extend_xrot=v.extend_xrot??-90;v.extend_yrot=v.extend_yrot??0;v.xbasepos=v.xbasepos??0;v.ybasepos=v.ybasepos??0;v.zbasepos=v.zbasepos??0;v.F.r5=-math.sin(v.xrot);v.F.r2=-math.sin(v.yrot);v.F.r3=-math.sin(v.zrot);v.F.r4=math.cos(v.zrot);v.F.r8=math.cos(v.yrot);v.F.r0=-v.F.r5*v.F.r2*v.F.r3+v.F.r8*v.F.r4;v.F.r1=-v.F.r5*v.F.r2*v.F.r4-v.F.r8*v.F.r3;v.F.r6=-v.F.r5*v.F.r8*v.F.r3-v.F.r2*v.F.r4;v.F.r7=-v.F.r5*v.F.r8*v.F.r4+v.F.r2*v.F.r3;v.F.r2=v.F.r2*math.cos(v.xrot);v.F.r3=v.F.r3*math.cos(v.xrot);v.F.r4=v.F.r4*math.cos(v.xrot);v.F.r8=v.F.r8*math.cos(v.xrot);v.F.e0=math.cos(v.extend_yrot);v.F.e4=math.cos(v.extend_xrot);v.F.e5=-math.sin(v.extend_xrot);v.F.e6=math.sin(v.extend_yrot);v.F.e1=v.F.e5*v.F.e6;v.F.e2=-v.F.e4*v.F.e6;v.F.e7=-v.F.e5*v.F.e0;v.F.e8=v.F.e4*v.F.e0;v.F.p0=v.F.r0*v.F.e0+v.F.r2*v.F.e6;v.F.p1=v.F.r0*v.F.e1+v.F.r1*v.F.e4+v.F.r2*v.F.e7;v.F.p2=v.F.r0*v.F.e2+v.F.r1*v.F.e5+v.F.r2*v.F.e8;v.F.p3=v.F.r3*v.F.e0+v.F.r5*v.F.e6;v.F.p4=v.F.r3*v.F.e1+v.F.r4*v.F.e4+v.F.r5*v.F.e7;v.F.p5=v.F.r3*v.F.e2+v.F.r4*v.F.e5+v.F.r5*v.F.e8;v.F.p6=v.F.r6*v.F.e0+v.F.r8*v.F.e6;v.F.p7=v.F.r6*v.F.e1+v.F.r7*v.F.e4+v.F.r8*v.F.e7;v.F.p8=v.F.r6*v.F.e2+v.F.r7*v.F.e5+v.F.r8*v.F.e8;",
  },
  {
    animation: "animation.creeper.swelling",
    controller: "wiki.fmbe.items.anim1",
    expression: "v.F.co=math.cos(25);v.F.si=math.sin(25);v.swelling_scale2=v.extend_scale*(v.swelling_scale1=(v.F.s=math.sqrt(17/8*v.scale)));",
  },
  {
    animation: "animation.ender_dragon.neck_head_movement",
    controller: "wiki.fmbe.items.anim2",
    expression: "v.F.X=(v.xpos-1)*v.F.p0+(v.ypos-1/128)*v.F.p3+v.zpos*v.F.p6+((v.xbasepos+11/29)*v.F.e0+(v.zbasepos+8/15)*v.F.e6*v.extend_scale)*v.scale;v.F.Y=(v.xpos-1)*v.F.p1+(v.ypos-1/128)*v.F.p4+v.zpos*v.F.p7+((v.xbasepos+11/29)*v.F.e1+(v.ybasepos+31/37)*v.F.e4+(v.zbasepos+8/15)*v.F.e7*v.extend_scale)*v.scale;v.head_position_y=16/v.F.s*(((v.xpos-1)*v.F.p2+(v.ypos-1/128)*v.F.p5+v.zpos*v.F.p8)/v.extend_scale+((v.xbasepos+11/29)*v.F.e2+(v.ybasepos+31/37)*v.F.e5+(v.zbasepos+8/15)*v.F.e8*v.extend_scale)*v.scale);v.head_position_x=16/v.F.s*(v.F.X*v.F.co-v.F.Y*v.F.si);v.head_position_z=16/v.F.s*(v.F.X*v.F.si+v.F.Y*v.F.co);v.head_rotation_x=v.F.e6*v.F.si+v.F.e7*v.F.co||v.F.e0*v.F.si*v.F.si+v.F.e1*v.F.si*v.F.co+v.F.e4*v.F.co*v.F.co?math.atan2(-v.F.e6*v.F.si-v.F.e7*v.F.co,v.F.e0*v.F.si*v.F.si+v.F.e1*v.F.si*v.F.co+v.F.e4*v.F.co*v.F.co):math.atan2(v.F.e2*v.F.si+v.F.e5*v.F.co,v.F.e8);v.head_rotation_y=math.asin(v.F.e4*v.F.si*v.F.co-v.F.e1*v.F.co*v.F.co-v.F.e0*v.F.co*v.F.si);v.head_rotation_z=v.F.e6*v.F.si+v.F.e7*v.F.co||v.F.e0*v.F.si*v.F.si+v.F.e1*v.F.si*v.F.co+v.F.e4*v.F.co*v.F.co?math.atan2(v.F.e5*v.F.si-v.F.e2*v.F.co,v.F.e0*v.F.co*v.F.co-v.F.e1*v.F.co*v.F.si+v.F.e4*v.F.si*v.F.si):0;",
  },
  {
    animation: "animation.warden.move",
    controller: "wiki.fmbe.items.anim3",
    expression: "v.body_x_rot=v.F.p5||v.F.p3*v.F.si+v.F.p4*v.F.co?math.atan2(v.F.p5,-v.F.p3*v.F.si-v.F.p4*v.F.co):math.atan2(-v.F.p0*v.F.si-v.F.p1*v.F.co,-v.F.p2);v.body_z_rot=v.F.p5||v.F.p3*v.F.si+v.F.p4*v.F.co?math.atan2(v.F.p0*v.F.co-v.F.p1*v.F.si,v.F.p7*v.F.si-v.F.p6*v.F.co):0;",
  },
  {
    animation: "animation.player.attack.rotations",
    controller: "wiki.fmbe.items.anim4",
    expression: "v.attack_body_rot_y=math.asin(v.F.p3*v.F.co-v.F.p4*v.F.si);",
  },
];
