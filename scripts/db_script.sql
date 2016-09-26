// Add mpin column
alter table restaurant_config add column mpin text;

alter table purchase_order add column session_name text;

ALTER TABLE session DROP COLUMN outlet_id;

ALTER TABLE session add COLUMN sequence integer;

alter table session add primary key (name);

ALTER TABLE purchase_order ADD FOREIGN KEY (session_name)  REFERENCES session(name);

ALTER TABLE menu_bands ADD FOREIGN KEY (name)  REFERENCES session(name);

ALTER TABLE volume_paln_automation ADD FOREIGN KEY (session)  REFERENCES session(name);


// alphanumeric_generator to get mpin 

create or replace function alphanumeric_generator(length integer) returns text as 
$$
declare
  chars text[] := '{0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z}';
  result text := '';
  i integer := 0;
begin
  if length < 0 then
    raise exception 'Given length cannot be less than 0';
  end if;
  for i in 1..length loop
    result := result || chars[1+random()*(array_length(chars, 1)-1)];
  end loop;
  
  if(select mpin from restaurant_config where mpin=result) then
  select alphanumeric_generator(length);
  end if;
  
  return result;
end;
$$ language plpgsql;



//Session seed 
INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'Early Breakfast','01:00:00','03:59:00',1);

INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'BreakFast','03:00:00','08:59:00',2);

INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'Lunch','09:00:00','12:59:00',3);

INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'Lunch1','09:00:00','12:59:00',4);

INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'Lunch2','13:00:00','14:59:00',5);

INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'Dinner','15:00:00','18:59:00',6);

INSERT INTO public.session(
	name, start_time, end_time, sequence)
	VALUES (
'LateDinner','19:00:00','23:00:00',7);